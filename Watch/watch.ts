// The checks themselves, shared by cron.ts (runs them on a schedule) and
// http.ts (shows the results, and can run them on demand).
import { blob } from 'https://esm.town/v/std/blob/main.ts'
import { email } from 'https://esm.town/v/std/email'

export const statusKey = 'watch:status'
const timeoutMs = 10_000 // a check that takes longer than this fails
const retryMs = 5_000 // wait before the second try

// Each check does a little of the val's real work, not just loads a
// page. It returns quietly if all is well, and throws if not.
const targets = {
    Rooms: async () => {
        // Reading a room goes through Rooms' SQLite database.
        const res = await get('https://backspaces-rooms.val.run/room/watch')
        const reply = await res.json()
        if (!Array.isArray(reply.messages))
            throw new Error('reply has no messages list')
    },
    // To test the "down" path without breaking Peers: change /peers.js
    // below to /nope.js, vt push, then Check now on the status page.
    // Undo: change it back, vt push, wait a minute, Check now.
    Peers: async () => {
        const res = await get('https://backspaces-peers.val.run/peers.js')
        const text = await res.text()
        if (!text.includes('export async function join')) {
            throw new Error('peers.js has no join()')
        }
    },
    // Listing items goes through Rest's SQLite database, like Rooms.
    Rest: async () => {
        const res = await get('https://backspaces-rest.val.run/items')
        const reply = await res.json()
        if (!Array.isArray(reply.items)) throw new Error('reply has no items list')
    },
}

async function get(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`)
    return res
}

// null if the check passed, otherwise what went wrong.
async function problemWith(check) {
    try {
        await check()
        return null
    } catch (e) {
        return e.message ?? String(e)
    }
}

// Val Town has occasional one-off errors (see Rooms' README). Trying
// twice, a few seconds apart, keeps those from sending an email.
async function checkTwice(check) {
    const problem = await problemWith(check)
    if (!problem) return null
    await new Promise(resolve => setTimeout(resolve, retryMs))
    return problemWith(check)
}

function minutesSince(iso) {
    return Math.round((Date.now() - Date.parse(iso)) / 60_000)
}

// Check every target, save the results, and email about anything that
// changed since last time. Returns the new status.
export async function runChecks() {
    const old = (await blob.getJSON(statusKey)) ?? { targets: {} }
    const checkedAt = new Date().toISOString()
    const results = await Promise.all(
        Object.entries(targets).map(async ([name, check]) => [
            name,
            await checkTwice(check),
        ])
    )

    const status = { checkedAt, targets: {} }
    const changes = []
    for (const [name, problem] of results) {
        const up = problem === null
        const before = old.targets[name]
        // A target seen for the first time just records a starting point.
        const changed = before !== undefined && before.up !== up
        const since = changed || !before ? checkedAt : before.since
        status.targets[name] = { up, since, problem }
        if (changed) {
            changes.push(
                up
                    ? {
                          subject: `${name} is back up`,
                          text: `${name} is back up, after about ${minutesSince(before.since)} minutes down.`,
                      }
                    : {
                          subject: `${name} is down`,
                          text: `${name} is down: ${problem}`,
                      }
            )
        }
    }

    await blob.setJSON(statusKey, status)
    console.log('Checked:', JSON.stringify(status.targets))

    if (changes.length) {
        await email({
            subject: 'Watch: ' + changes.map(c => c.subject).join(', '),
            text:
                changes.map(c => c.text).join('\n') +
                '\n\nStatus page: https://backspaces-watch.val.run/',
        })
        console.log('Emailed:', changes.map(c => c.subject).join(', '))
    }
    return status
}

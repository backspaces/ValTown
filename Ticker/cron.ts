export default function (interval) {
  console.log("Tick", new Date().toISOString(), "lastRunAt:", interval.lastRunAt);
}

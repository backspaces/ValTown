export async function emailValHandler(email) {
  console.log("Email received!", email.from, email.subject, email.text);
  for (const file of email.attachments) {
    console.log(`Filename: ${file.name}`);
    console.log(`Content Type: ${file.type}`);
  }
}

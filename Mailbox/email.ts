export async function emailValHandler(email) {
  console.log("Email received!", email.from, email.subject, email.text);
}

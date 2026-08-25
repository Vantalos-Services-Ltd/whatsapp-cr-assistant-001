import { redirect } from "next/navigation";

/**
 * The site root previously rendered a blank white page, because no route was
 * defined at "/". Anyone visiting localhost:3000 (or the deployed root) saw
 * nothing at all. Send them to the console instead; the operator layout will
 * bounce them to the login page if they are not signed in.
 */
export default function RootPage() {
  redirect("/operator");
}

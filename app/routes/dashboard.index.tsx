import { redirect } from "react-router";

export function loader() {
	return redirect("/dashboard/live-vibe");
}

export default function DashboardIndex() {
	return null;
}

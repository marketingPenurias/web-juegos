import { useNavigate } from "react-router";

export function LogoutButton() {
	const navigate = useNavigate();

	async function handleLogout() {
		// DELETE → api.auth-dashboard.ts borra la cookie HttpOnly en el servidor
		await fetch("/api/auth/dashboard", { method: "DELETE" });
		navigate("/", { replace: true });
	}

	return (
		<button
			type="button"
			onClick={handleLogout}
			className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5"
		>
			Cerrar sesión
		</button>
	);
}

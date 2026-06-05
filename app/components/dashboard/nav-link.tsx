import { NavLink as RouterNavLink } from "react-router";
import { cn } from "../../lib/utils";

type NavLinkProps = {
	to: string;
	label: string;
	description: string;
	icon: React.ReactNode;
};

export function NavLink({ to, label, description, icon }: NavLinkProps) {
	return (
		<RouterNavLink
			to={to}
			className={({ isActive }) =>
				cn(
					"flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors group",
					isActive
						? "bg-primary/10 text-primary"
						: "text-muted-foreground hover:bg-accent hover:text-foreground",
				)
			}
		>
			{({ isActive }) => (
				<>
					<span
						className={cn(
							"mt-0.5 shrink-0 transition-colors",
							isActive ? "text-primary" : "group-hover:text-foreground",
						)}
					>
						{icon}
					</span>
					<div className="min-w-0">
						<p
							className={cn(
								"text-sm font-medium leading-none",
								isActive ? "text-primary" : "text-foreground",
							)}
						>
							{label}
						</p>
						<p className="text-xs text-muted-foreground mt-0.5 leading-tight">
							{description}
						</p>
					</div>
				</>
			)}
		</RouterNavLink>
	);
}

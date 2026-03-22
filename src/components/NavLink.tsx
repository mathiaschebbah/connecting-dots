interface NavLinkProps {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}

export function NavLink({ label, icon, active, onClick }: NavLinkProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? "bg-neutral-800 text-white"
          : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
      }`}
    >
      <span className="text-base">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

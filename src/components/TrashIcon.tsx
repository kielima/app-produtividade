type TrashIconProps = {
  size?: number;
  className?: string;
};

export default function TrashIcon({ size = 20, className }: TrashIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M5 6v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6" />
      <line x1="9.5" y1="10" x2="9.5" y2="17" />
      <line x1="12" y1="10" x2="12" y2="17" />
      <line x1="14.5" y1="10" x2="14.5" y2="17" />
    </svg>
  );
}

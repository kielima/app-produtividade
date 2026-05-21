export type WeatherKind =
  | 'clear'
  | 'mostly-clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'showers'
  | 'snow-showers'
  | 'thunder'
  | 'thunder-hail'
  | 'unknown';

// Converte código WMO (Open-Meteo) num "kind" visual.
export function weatherKindFromCode(code: number): WeatherKind {
  if (code === 0) return 'clear';
  if (code === 1) return 'mostly-clear';
  if (code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code >= 85 && code <= 86) return 'snow-showers';
  if (code === 95) return 'thunder';
  if (code === 96 || code === 99) return 'thunder-hail';
  return 'unknown';
}

export function weatherLabel(kind: WeatherKind): string {
  switch (kind) {
    case 'clear':
      return 'Céu limpo';
    case 'mostly-clear':
      return 'Predominantemente limpo';
    case 'partly-cloudy':
      return 'Parcialmente nublado';
    case 'cloudy':
      return 'Nublado';
    case 'fog':
      return 'Neblina';
    case 'drizzle':
      return 'Garoa';
    case 'rain':
      return 'Chuva';
    case 'snow':
      return 'Neve';
    case 'showers':
      return 'Pancadas de chuva';
    case 'snow-showers':
      return 'Pancadas de neve';
    case 'thunder':
      return 'Trovoada';
    case 'thunder-hail':
      return 'Trovoada com granizo';
    default:
      return 'Tempo desconhecido';
  }
}

const SUN = '#FFC857';
const SUN_RAY = '#FFB73D';
const CLOUD_LIGHT = '#E2E8F2';
const CLOUD = '#B8C5D6';
const CLOUD_DARK = '#8FA0B8';
const RAIN = '#4FA8E8';
const SNOW = '#DCE9F5';
const SNOW_STROKE = '#9EBBD6';
const BOLT = '#FFD23F';
const BOLT_STROKE = '#E5A823';
const FOG = '#C5CFDC';

function Sun({ cx = 32, cy = 32, r = 12 }: { cx?: number; cy?: number; r?: number }) {
  const rays: [number, number, number, number][] = [
    [cx, cy - r - 8, cx, cy - r - 2],
    [cx, cy + r + 2, cx, cy + r + 8],
    [cx - r - 8, cy, cx - r - 2, cy],
    [cx + r + 2, cy, cx + r + 8, cy],
    [cx - r - 6, cy - r - 6, cx - r - 1, cy - r - 1],
    [cx + r + 1, cy + r + 1, cx + r + 6, cy + r + 6],
    [cx - r - 6, cy + r + 6, cx - r - 1, cy + r + 1],
    [cx + r + 1, cy - r - 1, cx + r + 6, cy - r - 6],
  ];
  return (
    <g>
      {rays.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={SUN_RAY}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
      ))}
      <circle cx={cx} cy={cy} r={r} fill={SUN} />
    </g>
  );
}

function Cloud({
  x = 0,
  y = 0,
  scale = 1,
  fill = CLOUD,
  stroke,
}: {
  x?: number;
  y?: number;
  scale?: number;
  fill?: string;
  stroke?: string;
}) {
  // Path desenhado num quadrado 64x64; aplicamos transform para reposicionar.
  return (
    <path
      transform={`translate(${x} ${y}) scale(${scale})`}
      d="M16 44h32a9 9 0 0 0 1.4-17.9 12 12 0 0 0-22.6-3.1A9 9 0 0 0 16 44Z"
      fill={fill}
      stroke={stroke}
      strokeWidth={stroke ? 1.5 : 0}
      strokeLinejoin="round"
    />
  );
}

function Raindrop({
  cx,
  cy,
  scale = 1,
  fill = RAIN,
}: {
  cx: number;
  cy: number;
  scale?: number;
  fill?: string;
}) {
  return (
    <path
      transform={`translate(${cx} ${cy}) scale(${scale})`}
      d="M0 -5 C 3 -1, 4 2, 0 5 C -4 2, -3 -1, 0 -5 Z"
      fill={fill}
    />
  );
}

function Snowflake({ cx, cy, size = 4 }: { cx: number; cy: number; size?: number }) {
  return (
    <g stroke={SNOW_STROKE} strokeWidth={1.5} strokeLinecap="round">
      <line x1={cx - size} y1={cy} x2={cx + size} y2={cy} />
      <line x1={cx} y1={cy - size} x2={cx} y2={cy + size} />
      <line
        x1={cx - size * 0.7}
        y1={cy - size * 0.7}
        x2={cx + size * 0.7}
        y2={cy + size * 0.7}
      />
      <line
        x1={cx - size * 0.7}
        y1={cy + size * 0.7}
        x2={cx + size * 0.7}
        y2={cy - size * 0.7}
      />
      <circle cx={cx} cy={cy} r={1.3} fill={SNOW} stroke="none" />
    </g>
  );
}

function Bolt({ x = 30, y = 38 }: { x?: number; y?: number }) {
  return (
    <path
      d={`M${x} ${y} l-5 9 h5 l-3 8 l9 -11 h-5 l4 -6 z`}
      fill={BOLT}
      stroke={BOLT_STROKE}
      strokeWidth={1}
      strokeLinejoin="round"
    />
  );
}

function ClearIcon() {
  return <Sun cx={32} cy={32} r={13} />;
}

function MostlyClearIcon() {
  return (
    <g>
      <Sun cx={24} cy={26} r={10} />
      <Cloud x={20} y={20} scale={0.7} />
    </g>
  );
}

function PartlyCloudyIcon() {
  return (
    <g>
      <Sun cx={20} cy={22} r={9} />
      <Cloud x={14} y={16} scale={0.9} />
    </g>
  );
}

function CloudyIcon() {
  return (
    <g>
      <Cloud x={-6} y={6} scale={0.75} fill={CLOUD_LIGHT} />
      <Cloud x={4} y={10} scale={0.95} fill={CLOUD} />
    </g>
  );
}

function FogIcon() {
  return (
    <g>
      <Cloud y={-2} fill={CLOUD_LIGHT} />
      <g stroke={FOG} strokeWidth={3} strokeLinecap="round">
        <line x1={10} y1={50} x2={48} y2={50} />
        <line x1={14} y1={56} x2={54} y2={56} />
      </g>
    </g>
  );
}

function DrizzleIcon() {
  return (
    <g>
      <Cloud y={-2} fill={CLOUD} />
      <Raindrop cx={22} cy={52} scale={0.7} />
      <Raindrop cx={32} cy={56} scale={0.7} />
      <Raindrop cx={42} cy={52} scale={0.7} />
    </g>
  );
}

function RainIcon() {
  return (
    <g>
      <Cloud y={-4} fill={CLOUD_DARK} />
      <Raindrop cx={20} cy={50} scale={1} />
      <Raindrop cx={30} cy={54} scale={1} />
      <Raindrop cx={40} cy={50} scale={1} />
      <Raindrop cx={48} cy={54} scale={1} />
    </g>
  );
}

function ShowersIcon() {
  return (
    <g>
      <Sun cx={20} cy={18} r={7} />
      <Cloud x={8} y={10} scale={0.85} fill={CLOUD} />
      <Raindrop cx={26} cy={54} scale={1.1} />
      <Raindrop cx={38} cy={58} scale={1.1} />
      <Raindrop cx={48} cy={54} scale={1.1} />
    </g>
  );
}

function SnowIcon() {
  return (
    <g>
      <Cloud y={-4} fill={CLOUD_LIGHT} />
      <Snowflake cx={20} cy={52} />
      <Snowflake cx={32} cy={56} />
      <Snowflake cx={44} cy={52} />
    </g>
  );
}

function SnowShowersIcon() {
  return (
    <g>
      <Sun cx={20} cy={18} r={7} />
      <Cloud x={8} y={10} scale={0.85} fill={CLOUD_LIGHT} />
      <Snowflake cx={26} cy={54} />
      <Snowflake cx={40} cy={56} />
    </g>
  );
}

function ThunderIcon() {
  return (
    <g>
      <Cloud y={-6} fill={CLOUD_DARK} />
      <Bolt x={28} y={36} />
      <Raindrop cx={18} cy={52} scale={0.9} />
      <Raindrop cx={48} cy={52} scale={0.9} />
    </g>
  );
}

function ThunderHailIcon() {
  return (
    <g>
      <Cloud y={-6} fill={CLOUD_DARK} />
      <Bolt x={28} y={36} />
      <circle cx={20} cy={54} r={2.5} fill={SNOW} stroke={SNOW_STROKE} strokeWidth={1} />
      <circle cx={32} cy={58} r={2.5} fill={SNOW} stroke={SNOW_STROKE} strokeWidth={1} />
      <circle cx={46} cy={54} r={2.5} fill={SNOW} stroke={SNOW_STROKE} strokeWidth={1} />
    </g>
  );
}

function UnknownIcon() {
  return (
    <g>
      <circle cx={32} cy={32} r={20} fill={CLOUD_LIGHT} />
      <text
        x={32}
        y={40}
        textAnchor="middle"
        fontSize={24}
        fontWeight={700}
        fill={CLOUD_DARK}
      >
        ?
      </text>
    </g>
  );
}

const ICONS: Record<WeatherKind, () => JSX.Element> = {
  clear: ClearIcon,
  'mostly-clear': MostlyClearIcon,
  'partly-cloudy': PartlyCloudyIcon,
  cloudy: CloudyIcon,
  fog: FogIcon,
  drizzle: DrizzleIcon,
  rain: RainIcon,
  showers: ShowersIcon,
  snow: SnowIcon,
  'snow-showers': SnowShowersIcon,
  thunder: ThunderIcon,
  'thunder-hail': ThunderHailIcon,
  unknown: UnknownIcon,
};

export function WeatherIcon({
  kind,
  size = 64,
  className,
}: {
  kind: WeatherKind;
  size?: number;
  className?: string;
}) {
  const Renderer = ICONS[kind] ?? UnknownIcon;
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={weatherLabel(kind)}
    >
      <Renderer />
    </svg>
  );
}

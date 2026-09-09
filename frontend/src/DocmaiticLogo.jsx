// docmaitic Logo – für frontend/src/DocmaiticLogo.jsx
// Verwendung:
//   <DocmaiticLogo />                      Standard-Lockup im Header
//   <DocmaiticLogo size={22} />            größer
//   <DocmaiticLogo variant="invers" />     auf dunklem/blauem Grund
//   <DocmaiticLogo variant="mono" />       einfarbig, für Druck/Fax/Graustufen
//   <DocmaiticMark size={32} />            nur das Zeichen (App-Icon, Favicon, Collapsed-Sidebar)

const PALETTE = {
  farbe:  { top: '#C8C8BE', mid: '#8FA3B4', base: '#12395C', text: '#1A1A18', ai: '#12395C' },
  mono:   { top: '#1A1A18', mid: '#1A1A18', base: '#1A1A18', text: '#1A1A18', ai: '#1A1A18' },
  invers: { top: '#FFFFFF', mid: '#FFFFFF', base: '#FFFFFF', text: '#FFFFFF', ai: '#FFFFFF' },
};

export function DocmaiticMark({ size = 24, variant = 'farbe', tile = false }) {
  const c = PALETTE[variant] ?? PALETTE.farbe;
  const bar = (w, color) => (
    <span
      style={{
        display: 'block',
        width: `${w * size}px`,
        height: `${0.25 * size}px`,
        borderRadius: `${Math.max(1, 0.06 * size)}px`,
        background: color,
      }}
    />
  );
  const stack = (
    <span style={{ display: 'flex', flexDirection: 'column', gap: `${0.105 * size}px`, flex: 'none' }}>
      {bar(1, c.top)}
      {bar(0.74, c.mid)}
      {bar(0.48, c.base)}
    </span>
  );

  if (!tile) return stack;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${0.22 * size}px`,
        background: variant === 'invers' ? '#FFFFFF' : '#12395C',
        flex: 'none',
      }}
    >
      <DocmaiticMark size={size * 0.62} variant={variant === 'invers' ? 'farbe' : 'invers'} />
    </span>
  );
}

export default function DocmaiticLogo({ size = 18, variant = 'farbe', showMark = true }) {
  const c = PALETTE[variant] ?? PALETTE.farbe;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: `${0.7 * size}px` }}>
      {showMark && <DocmaiticMark size={size * 1.35} variant={variant} />}
      <span
        style={{
          fontFamily: '"Space Grotesk", Helvetica, Arial, sans-serif',
          fontSize: `${size}px`,
          fontWeight: 500,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          color: c.text,
          whiteSpace: 'nowrap',
        }}
      >
        docm<span style={{ fontWeight: 700, color: c.ai }}>ai</span>tic
      </span>
    </span>
  );
}

/** The drifting star layer behind every screen. Pure CSS: three tiled radial-gradient dots. */
export function Starfield() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="animate-drift absolute inset-0 opacity-90"
        style={{
          backgroundImage:
            'radial-gradient(1.5px 1.5px at 20px 30px, #fff 50%, transparent 51%), radial-gradient(1px 1px at 140px 90px, #9aa3b5 50%, transparent 51%), radial-gradient(1.2px 1.2px at 260px 210px, #c8ff4d 50%, transparent 51%)',
          backgroundSize: '300px 300px, 220px 220px, 520px 520px',
        }}
      />
      <div
        className="absolute left-1/2 -top-[30%] size-[1100px] -translate-x-1/2"
        style={{ background: 'radial-gradient(closest-side, rgb(90 228 255 / 0.1), transparent)' }}
      />
    </div>
  );
}

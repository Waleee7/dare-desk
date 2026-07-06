import Link from 'next/link';

// Fixed strip on every preview so Josh can hop between design directions.
export default function Switcher({ active }: { active: 'ledger' | 'terminal' | 'broker' }) {
  const items = [
    { id: 'ledger', href: '/v/ledger', label: '1 · The Ledger' },
    { id: 'terminal', href: '/v/terminal', label: '2 · Command Rail' },
    { id: 'broker', href: '/v/broker', label: '3 · Clean Broker' },
  ] as const;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px',
      background: '#111', borderBottom: '1px solid #333',
      fontFamily: 'system-ui, sans-serif', fontSize: 12.5,
    }}>
      <span style={{ color: '#888', marginRight: 6, fontWeight: 700 }}>DESIGN PREVIEW · sample data</span>
      {items.map((i) => (
        <Link key={i.id} href={i.href} style={{
          color: active === i.id ? '#111' : '#ccc',
          background: active === i.id ? '#e8c25c' : 'transparent',
          padding: '4px 10px', borderRadius: 6, fontWeight: 700, textDecoration: 'none',
        }}>{i.label}</Link>
      ))}
      <span style={{ flex: 1 }} />
      <Link href="/" style={{ color: '#888', textDecoration: 'none' }}>current dashboard →</Link>
    </div>
  );
}

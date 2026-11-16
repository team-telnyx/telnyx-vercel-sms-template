/**
 * How a text gets from a phone to this app and back. Plain HTML and CSS so it
 * follows the theme and stacks on small screens.
 */
const NODES = [
  { area: "phone", label: "Your phone" },
  { area: "carriers", label: "US carriers" },
  { area: "telnyx", label: "Telnyx" },
  { area: "app", label: "Your app" },
] as const;

function Connector({ area, blocked = false }: { area: string; blocked?: boolean }) {
  const out = blocked ? "var(--bad)" : "var(--muted-2)";
  return (
    <div className={`conn ${area}`} style={{ gridArea: area }} aria-hidden="true">
      <svg className="conn-h" viewBox="0 0 72 40" width="72" height="40">
        <path d="M8 12H62M57 7l5 5-5 5" stroke="var(--ok)" />
        {blocked ? (
          <>
            <path d="M62 29H44M24 29H14" stroke={out} strokeDasharray="3 3" />
            <path d="M18 24l-5 5 5 5" stroke={out} />
            <circle cx="34" cy="29" r="6.5" fill="var(--card)" stroke="var(--bad)" />
            <path d="M29.5 24.5l9 9" stroke="var(--bad)" />
          </>
        ) : (
          <path d="M64 29H10M15 24l-5 5 5 5" stroke={out} />
        )}
      </svg>
      <svg className="conn-v" viewBox="0 0 44 52" width="44" height="52">
        <path d="M14 4V46M9 41l5 5 5-5" stroke="var(--ok)" />
        {blocked ? (
          <>
            <path d="M30 48V34M30 18V8" stroke={out} strokeDasharray="3 3" />
            <path d="M25 9l5-5 5 5" stroke={out} />
            <circle cx="30" cy="26" r="6.5" fill="var(--card)" stroke="var(--bad)" />
            <path d="M25.5 21.5l9 9" stroke="var(--bad)" />
          </>
        ) : (
          <path d="M30 48V6M25 11l5-5 5 5" stroke={out} />
        )}
      </svg>
    </div>
  );
}

export function TravelDiagram() {
  return (
    <section className="card travel" aria-labelledby="travel-title">
      <h2 id="travel-title">How your texts travel</h2>
      <figure className="travel-figure">
        <p className="sr-only">
          Texts in go from your phone through US carriers and Telnyx to your app, and work now. The Campaign
          Registry checks every sender. Texts out to US phones are held at the carrier until your number is
          registered.
        </p>
        <div className="travel-grid" aria-hidden="true">
          {NODES.map((n) => (
            <div key={n.area} className={`node node-${n.area}`} style={{ gridArea: n.area }}>
              {n.label}
            </div>
          ))}
          <Connector area="c1" blocked />
          <Connector area="c2" />
          <Connector area="c3" />
          <div className="tcr" style={{ gridArea: "tcr" }}>
            The Campaign Registry checks every sender
          </div>
        </div>
        <figcaption className="legend" aria-hidden="true">
          <span>
            <i className="key key-in" /> Texts in work now
          </span>
          <span>
            <i className="key key-out" /> Texts out to US phones are held at the carrier until you register
          </span>
        </figcaption>
      </figure>
    </section>
  );
}

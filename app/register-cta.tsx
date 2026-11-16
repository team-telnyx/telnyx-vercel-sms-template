/** Why texts to US phones wait at the carrier, and the button that fixes it. */
export function RegisterCta({ href, docsHref }: { href: string; docsHref: string }) {
  return (
    <section id="register" className="card register" aria-labelledby="register-title" tabIndex={-1}>
      <h2 id="register-title">Why texts to US phones stop at the carrier</h2>
      <p>
        US carriers only deliver texts from registered senders. Register your business and how you&apos;ll text
        people (10DLC). It takes about a week, and receiving texts works now.
      </p>
      <div className="actions">
        <a className="btn btn-primary" href={href}>
          Register for US messaging
        </a>
        <a className="link" href={docsHref}>
          Costs and timing
        </a>
      </div>
    </section>
  );
}

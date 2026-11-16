/** One setup step: one line, one button. */
export function SetupCard(props: {
  step?: string;
  number?: string;
  text: string;
  action?: { label: string; href: string };
  note?: string;
}) {
  return (
    <section className="card setup" aria-labelledby="setup-text">
      {props.step ? <p className="eyebrow">{props.step}</p> : null}
      {props.number ? <p className="setup-number">{props.number}</p> : null}
      <h1 id="setup-text" className="setup-text">
        {props.text}
      </h1>
      {props.action ? (
        <a className="btn btn-primary" href={props.action.href}>
          {props.action.label}
        </a>
      ) : null}
      {props.note ? <p className="muted small">{props.note}</p> : null}
    </section>
  );
}

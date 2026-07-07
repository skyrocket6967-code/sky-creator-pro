import { pricingPlans } from '../data/demoData'

type PricingPageProps = {
  onPlaceholderAction: (label: string) => void
}

export function PricingPage({ onPlaceholderAction }: PricingPageProps) {
  return (
    <section className="page-shell pricing-page">
      <div className="page-heading centered">
        <p className="eyebrow">Pricing</p>
        <h1>Start free. Upgrade when the workflow grows.</h1>
        <p>Free and Pro plans are shown as frontend placeholders until accounts and billing are connected.</p>
      </div>

      <div className="pricing-grid">
        {pricingPlans.map((plan) => (
          <article className={plan.featured ? 'pricing-card featured' : 'pricing-card'} key={plan.name}>
            <div className="pricing-card-header">
              <h2>{plan.name}</h2>
              <p>{plan.description}</p>
            </div>
            <div className="price-line">
              <strong>{plan.price}</strong>
              <span>{plan.cadence}</span>
            </div>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <button
              className={plan.featured ? 'button primary' : 'button secondary'}
              type="button"
              onClick={() => onPlaceholderAction(`${plan.name} plan`)}
            >
              Choose {plan.name}
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

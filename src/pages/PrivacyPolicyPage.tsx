import type { User } from '@supabase/supabase-js'
import { WebsiteHeader } from './WindowsDownloadPage'

type WebsiteRoute = 'home' | 'signup' | 'login' | 'dashboard' | 'download' | 'privacy'

type PrivacyPolicyPageProps = {
  user: User | null
  profileName?: string
  onNavigate: (route: WebsiteRoute) => void
  onLogout: () => void
}

const policySections = [
  {
    title: 'Introduction',
    body: [
      'Welcome to Sky Creator Pro. We value your privacy and are committed to protecting your personal information.',
      'By using Sky Creator Pro or our website, you agree to this Privacy Policy.',
    ],
  },
  {
    title: 'Information We Collect',
    body: ['We may collect the following information when you use Sky Creator Pro, create an account, upload projects, or visit our website:'],
    list: [
      'Account email address',
      'Username',
      'Password, stored securely and never in plain text',
      'Subscription information',
      'Cloud project metadata',
      'Files uploaded to cloud storage',
      'Device and diagnostic information',
      'IP address',
      'Browser information',
      'Crash reports',
      'Usage analytics',
    ],
  },
  {
    title: 'How We Use Information',
    body: ['We use information to operate, protect, and improve Sky Creator Pro, including to:'],
    list: [
      'Provide the service',
      'Save cloud projects',
      'Authenticate accounts',
      'Improve the software',
      'Fix bugs',
      'Process subscriptions',
      'Prevent fraud and abuse',
      'Provide customer support',
    ],
  },
  {
    title: 'Cloud Storage',
    body: [
      'Cloud projects are private by default. Users may choose to share projects with other Sky Creator Pro accounts or future Team Workspaces.',
      'Shared projects are only accessible to users granted permission. Users can remove shared access at any time.',
    ],
  },
  {
    title: 'Data Sharing',
    body: [
      'We do not sell personal information. We do not sell user data to advertisers.',
      'We do not share personal information except when required by law or when necessary to operate the service, such as with payment processing or cloud hosting providers.',
    ],
  },
  {
    title: 'Payments',
    body: [
      'Payment processing is handled by trusted third-party payment providers such as PayPal and Stripe.',
      'Sky Creator Pro does not store full credit card numbers.',
    ],
  },
  {
    title: 'Cookies',
    body: ['The website may use cookies for login sessions, remembering preferences, analytics, and security. Users may disable cookies in their browser.'],
  },
  {
    title: 'Account Deletion',
    body: [
      'Users may request deletion of their account, cloud projects, and personal data.',
      'Some records may be retained where required for legal, tax, fraud prevention, or security purposes.',
    ],
  },
  {
    title: 'Security',
    body: [
      'Sky Creator Pro uses reasonable security measures to protect user information, including encrypted connections (HTTPS), secure authentication, and access controls.',
      'No system can be guaranteed to be 100% secure.',
    ],
  },
  {
    title: "Children's Privacy",
    body: ['The service is not intended for children under the minimum age required by applicable law without parental involvement.'],
  },
  {
    title: 'Changes',
    body: ['This Privacy Policy may be updated from time to time. Users should check this page periodically for updates.'],
  },
]

function formatLastUpdated() {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())
}

export function PrivacyPolicyPage({ user, profileName, onNavigate, onLogout }: PrivacyPolicyPageProps) {
  return (
    <main className="download-page">
      <WebsiteHeader user={user} profileName={profileName} onNavigate={onNavigate} onLogout={onLogout} />
      <section className="privacy-page">
        <div className="privacy-hero">
          <p className="eyebrow">Privacy Policy</p>
          <h1>Privacy Policy</h1>
          <p className="privacy-updated">Last Updated: {formatLastUpdated()}</p>
        </div>

        <div className="privacy-content">
          {policySections.map((section) => (
            <article className="privacy-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.list && (
                <ul>
                  {section.list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}

          <article className="privacy-section contact-card">
            <h2>Contact</h2>
            <p>Questions about this Privacy Policy can be sent to Sky Creator Pro.</p>
            <dl>
              <div>
                <dt>Email</dt>
                <dd>
                  <a href="mailto:support@skycreatorpro.com">support@skycreatorpro.com</a>
                </dd>
              </div>
              <div>
                <dt>Website</dt>
                <dd>
                  <a href="https://skycreatorpro.com">https://skycreatorpro.com</a>
                </dd>
              </div>
            </dl>
          </article>
        </div>
      </section>
    </main>
  )
}

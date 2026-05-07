import type { ReactNode } from 'react';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';

const EFFECTIVE_DATE = 'May 6, 2025';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-10">
      <h2 className="font-serif text-2xl">{title}</h2>
      <div className="mt-3 space-y-3 text-r1-text-muted">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Privacy Policy</h1>
        <p className="mt-3 text-sm text-r1-text-muted">Effective date: {EFFECTIVE_DATE}</p>

        <p className="mt-6 text-r1-text-muted">
          GooseyPrime, Inc. ("<strong className="text-r1-text">Company</strong>",{' '}
          "<strong className="text-r1-text">we</strong>", "<strong className="text-r1-text">us</strong>", or{' '}
          "<strong className="text-r1-text">our</strong>") operates the ResearchOne service (the{' '}
          "<strong className="text-r1-text">Service</strong>"). This Privacy Policy explains what personal
          information we collect, how we use it, and your choices. By using the Service you agree to this policy.
        </p>

        <Section id="information-we-collect" title="1. Information We Collect">
          <p>
            <strong className="text-r1-text">Information you provide directly.</strong> When you create an account,
            subscribe, or contact us, we collect information such as your name, email address, billing information
            (processed by our payment processor — we do not store full card numbers), organization name, and any
            other details you choose to provide.
          </p>
          <p>
            <strong className="text-r1-text">Research content.</strong> We collect the research objectives, queries,
            custom corpora, documents, and other materials ("<strong className="text-r1-text">User Content</strong>")
            you submit when using the Service. This content is processed to generate reports and is stored to
            maintain your history and allow exports.
          </p>
          <p>
            <strong className="text-r1-text">BYOK credentials.</strong> If you use the Bring Your Own Keys (BYOK)
            feature, we collect the API keys you supply. These are encrypted at rest, never logged in plaintext, and
            used only to route your model calls to the third-party provider you designate.
          </p>
          <p>
            <strong className="text-r1-text">Usage and log data.</strong> We automatically collect information about
            how you interact with the Service, including IP address, browser and device type, operating system,
            referring URL, pages viewed, features used, run identifiers, timestamps, and error logs.
          </p>
          <p>
            <strong className="text-r1-text">Cookies and similar technologies.</strong> We use session cookies,
            persistent cookies, and similar tracking technologies to authenticate you, remember your preferences, and
            gather analytics. You can configure your browser to refuse cookies, but some features may not function
            correctly if you do.
          </p>
        </Section>

        <Section id="how-we-use" title="2. How We Use Your Information">
          <p>We use the information we collect to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Provide, operate, and improve the Service;</li>
            <li>Process transactions and send related invoices and receipts;</li>
            <li>Authenticate you and secure your account;</li>
            <li>Respond to your support requests and inquiries;</li>
            <li>Send product and service communications (you may opt out of marketing emails at any time);</li>
            <li>Monitor usage for abuse prevention, rate limiting, and platform security;</li>
            <li>
              Conduct analytics and research to understand usage patterns and improve model performance — using
              only anonymized or aggregated data;
            </li>
            <li>Comply with legal obligations and enforce our Terms of Service.</li>
          </ul>
          <p>
            We do <strong className="text-r1-text">not</strong> sell your personal information or User Content to
            third parties.
          </p>
          <p>
            We do <strong className="text-r1-text">not</strong> use identifiable User Content (your research
            queries or report text) to train or fine-tune AI models without your explicit opt-in consent.
          </p>
        </Section>

        <Section id="legal-basis" title="3. Legal Basis for Processing (EEA / UK Users)">
          <p>
            If you are located in the European Economic Area or the United Kingdom, our legal bases for processing
            your personal data are:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong className="text-r1-text">Contract performance</strong> — processing necessary to provide the
              Service to you under our Terms of Service;
            </li>
            <li>
              <strong className="text-r1-text">Legitimate interests</strong> — fraud prevention, security
              monitoring, product improvement using anonymized analytics, and other interests that do not override
              your rights;
            </li>
            <li>
              <strong className="text-r1-text">Legal obligation</strong> — compliance with applicable laws;
            </li>
            <li>
              <strong className="text-r1-text">Consent</strong> — where we ask for it, such as for optional
              marketing communications or AI-model improvement programs.
            </li>
          </ul>
        </Section>

        <Section id="sharing" title="4. How We Share Your Information">
          <p>We may share your information with:</p>
          <p>
            <strong className="text-r1-text">Service providers.</strong> We engage third-party vendors to help
            operate the Service (e.g., cloud infrastructure, payment processing, email delivery, error monitoring,
            analytics). These parties access personal information only as needed to perform their functions and are
            contractually required to protect it.
          </p>
          <p>
            <strong className="text-r1-text">AI model providers.</strong> When you submit a research query, the
            query text is sent to one or more AI inference providers (e.g., OpenRouter, Hugging Face, Together.ai)
            to generate report content. Only the content necessary for inference is transmitted; it is subject to
            those providers' own data-handling terms.
          </p>
          <p>
            <strong className="text-r1-text">Business transfers.</strong> If the Company is involved in a merger,
            acquisition, or asset sale, your information may be transferred. We will notify you before your personal
            information becomes subject to a different privacy policy.
          </p>
          <p>
            <strong className="text-r1-text">Legal and safety disclosures.</strong> We may disclose information if
            required by law, subpoena, or other legal process, or if we believe disclosure is necessary to protect
            our rights, your safety, or the safety of others.
          </p>
          <p>
            We do not share personal information with advertisers or data brokers.
          </p>
        </Section>

        <Section id="data-retention" title="5. Data Retention">
          <p>
            We retain your account information and User Content for as long as your account is active and for a
            reasonable period thereafter to allow you to reactivate, comply with legal obligations, resolve
            disputes, and enforce agreements. Research run data (queries, reports, citations) is retained for the
            period of your subscription and up to 90 days after account deletion, after which it is purged from
            production systems.
          </p>
          <p>
            Anonymized, aggregated analytics data may be retained indefinitely as it cannot reasonably be used to
            identify you.
          </p>
          <p>
            You may request deletion of your personal data at any time (see Section 8). Backup copies may persist
            for up to 30 additional days before being overwritten by routine retention cycles.
          </p>
        </Section>

        <Section id="security" title="6. Security">
          <p>
            We implement industry-standard technical and organizational measures to protect your information,
            including:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Encryption of data in transit (TLS 1.2+) and at rest (AES-256);</li>
            <li>Encryption of BYOK credentials with keys stored separately from data;</li>
            <li>Per-user row-level isolation on shared infrastructure;</li>
            <li>Access controls limiting employee access to personal data on a need-to-know basis;</li>
            <li>Periodic security reviews and dependency audits.</li>
          </ul>
          <p>
            No security system is impenetrable. If you discover a vulnerability, please report it responsibly to{' '}
            <a href="mailto:security@researchone.app" className="text-r1-accent hover:underline">
              security@researchone.app
            </a>
            .
          </p>
        </Section>

        <Section id="international-transfers" title="7. International Data Transfers">
          <p>
            Our servers are located in the United States. If you access the Service from outside the United States,
            your information may be transferred to and processed in a country with different data-protection laws
            than your own.
          </p>
          <p>
            For transfers from the EEA, UK, or Switzerland to the United States, we rely on Standard Contractual
            Clauses (SCCs) approved by the European Commission or the UK equivalent, or other lawful transfer
            mechanisms as applicable.
          </p>
        </Section>

        <Section id="your-rights" title="8. Your Rights and Choices">
          <p>
            Depending on your jurisdiction, you may have the following rights regarding your personal information:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong className="text-r1-text">Access</strong> — request a copy of the personal information we
              hold about you;
            </li>
            <li>
              <strong className="text-r1-text">Correction</strong> — request that inaccurate or incomplete
              information be corrected;
            </li>
            <li>
              <strong className="text-r1-text">Deletion</strong> — request that your personal information be
              deleted (subject to legal retention obligations);
            </li>
            <li>
              <strong className="text-r1-text">Restriction / objection</strong> — request that we restrict
              processing or object to processing based on legitimate interests;
            </li>
            <li>
              <strong className="text-r1-text">Portability</strong> — receive your data in a structured,
              machine-readable format;
            </li>
            <li>
              <strong className="text-r1-text">Withdraw consent</strong> — where processing is based on consent,
              withdraw it at any time without affecting the lawfulness of prior processing.
            </li>
          </ul>
          <p>
            To exercise any of these rights, contact us at{' '}
            <a href="mailto:privacy@researchone.app" className="text-r1-accent hover:underline">
              privacy@researchone.app
            </a>
            . We will respond within 30 days (or within any shorter period required by applicable law). We may need
            to verify your identity before acting on a request.
          </p>
          <p>
            You may also export or delete your research data directly from account settings without contacting us.
          </p>
          <p>
            <strong className="text-r1-text">Marketing emails.</strong> You may unsubscribe from marketing emails
            at any time by clicking the unsubscribe link in the email or by contacting us. You will continue to
            receive transactional messages (e.g., receipts, security alerts).
          </p>
        </Section>

        <Section id="children" title="9. Children's Privacy">
          <p>
            The Service is not directed to children under 13 (or under 16 in the EEA/UK). We do not knowingly
            collect personal information from children. If you believe a child has provided us with personal
            information, please contact us at{' '}
            <a href="mailto:privacy@researchone.app" className="text-r1-accent hover:underline">
              privacy@researchone.app
            </a>{' '}
            and we will delete it promptly.
          </p>
        </Section>

        <Section id="third-party-links" title="10. Third-Party Links and Services">
          <p>
            The Service may contain links to third-party websites or integrate with third-party services. This
            Privacy Policy does not apply to those third parties. We encourage you to review the privacy policies
            of any third-party services you use.
          </p>
        </Section>

        <Section id="california" title="11. California Privacy Rights (CCPA / CPRA)">
          <p>
            If you are a California resident, you have the right to: know what personal information we collect,
            use, disclose, or sell; request deletion of your personal information; opt out of the sale or sharing
            of personal information (we do not sell or share personal information for cross-context behavioral
            advertising); and not be discriminated against for exercising these rights.
          </p>
          <p>
            To submit a CCPA request, contact us at{' '}
            <a href="mailto:privacy@researchone.app" className="text-r1-accent hover:underline">
              privacy@researchone.app
            </a>{' '}
            or via account settings. We will respond within 45 days.
          </p>
        </Section>

        <Section id="changes" title="12. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will post the revised policy on this page and
            update the effective date. For material changes, we will provide at least 14 days' advance notice via
            email or in-app notification. Your continued use of the Service after the effective date constitutes
            acceptance of the updated policy.
          </p>
        </Section>

        <Section id="contact" title="13. Contact Us">
          <p>
            Questions, concerns, or requests regarding this Privacy Policy should be directed to:
          </p>
          <address className="not-italic">
            <p>GooseyPrime, Inc.</p>
            <p>
              Email:{' '}
              <a href="mailto:privacy@researchone.app" className="text-r1-accent hover:underline">
                privacy@researchone.app
              </a>
            </p>
          </address>
          <p>
            If you are located in the EEA or UK and believe we have not handled your data in accordance with
            applicable law, you have the right to lodge a complaint with your local supervisory authority.
          </p>
        </Section>
      </main>
      <LandingFooter />
    </div>
  );
}

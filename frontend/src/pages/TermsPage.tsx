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

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Terms of Service</h1>
        <p className="mt-3 text-sm text-r1-text-muted">Effective date: {EFFECTIVE_DATE}</p>

        <p className="mt-6 text-r1-text-muted">
          These Terms of Service ("<strong className="text-r1-text">Terms</strong>") govern your access to and use of
          ResearchOne (the "<strong className="text-r1-text">Service</strong>"), operated by GooseyPrime, Inc.
          ("<strong className="text-r1-text">Company</strong>", "<strong className="text-r1-text">we</strong>",
          "<strong className="text-r1-text">us</strong>", or "<strong className="text-r1-text">our</strong>"). By
          creating an account or using the Service you agree to be bound by these Terms. If you do not agree, do not
          use the Service.
        </p>

        <Section id="eligibility" title="1. Eligibility">
          <p>
            You must be at least 18 years old and capable of forming a binding contract to use the Service. By using
            the Service you represent and warrant that you meet these requirements. If you are using the Service on
            behalf of an organization, you represent that you have authority to bind that organization to these Terms,
            in which case "<strong className="text-r1-text">you</strong>" refers to that organization.
          </p>
        </Section>

        <Section id="accounts" title="2. Accounts and Security">
          <p>
            You are responsible for maintaining the confidentiality of your account credentials and for all activity
            that occurs under your account. You agree to notify us immediately at{' '}
            <a href="mailto:security@researchone.app" className="text-r1-accent hover:underline">
              security@researchone.app
            </a>{' '}
            of any unauthorized use of your account. We will not be liable for any losses arising from unauthorized
            access due to your failure to safeguard your credentials.
          </p>
          <p>
            You may not share your account, sell or transfer it, or allow third parties to access the Service through
            your credentials.
          </p>
        </Section>

        <Section id="service-description" title="3. Service Description">
          <p>
            ResearchOne provides AI-assisted research and report generation tools. The Service allows you to submit
            research objectives and receive synthesized reports sourced from publicly available information and, where
            configured, data sources you supply. Reports are generated using large language models and automated
            reasoning pipelines and are provided for informational purposes only.
          </p>
          <p>
            <strong className="text-r1-text">Reports are not professional advice.</strong> Nothing produced by the
            Service constitutes legal, financial, medical, investment, or any other form of professional advice. You
            should verify all material facts independently and consult qualified professionals before acting on any
            information in a report.
          </p>
        </Section>

        <Section id="subscriptions-billing" title="4. Subscriptions and Billing">
          <p>
            We offer paid subscription plans and wallet credits as described on our{' '}
            <a href="/pricing" className="text-r1-accent hover:underline">
              Pricing
            </a>{' '}
            page. All fees are stated in US dollars and are exclusive of applicable taxes unless stated otherwise.
            Taxes are your responsibility.
          </p>
          <p>
            <strong className="text-r1-text">Subscriptions</strong> renew automatically at the end of each billing
            period unless you cancel before the renewal date. You may cancel at any time from account settings;
            cancellation takes effect at the end of the current paid period and you will retain access until then.
          </p>
          <p>
            <strong className="text-r1-text">Wallet credits</strong> are non-refundable and expire 12 months after
            purchase unless applicable law requires otherwise.
          </p>
          <p>
            We may change pricing at any time. We will give you at least 30 days' advance notice of any price
            increase for active subscriptions. Your continued use of the Service after the effective date of a price
            change constitutes acceptance of the new price.
          </p>
          <p>
            If a payment fails, we may suspend your access to paid features until the outstanding balance is settled.
            We reserve the right to pursue collection of unpaid fees.
          </p>
        </Section>

        <Section id="refunds" title="5. Refunds">
          <p>
            Subscription fees are generally non-refundable. If you believe you were charged in error, contact{' '}
            <a href="mailto:billing@researchone.app" className="text-r1-accent hover:underline">
              billing@researchone.app
            </a>{' '}
            within 14 days of the charge and we will review your request. We will issue a pro-rata refund if a
            material service outage lasting more than 24 consecutive hours occurs during your paid period and is
            attributable solely to us.
          </p>
        </Section>

        <Section id="acceptable-use" title="6. Acceptable Use">
          <p>You agree not to use the Service to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Violate any applicable law or regulation;</li>
            <li>Generate, distribute, or facilitate the creation of malware, phishing content, or other harmful code;</li>
            <li>Harass, threaten, defame, or harm any person;</li>
            <li>Infringe the intellectual property, privacy, or other rights of any third party;</li>
            <li>Attempt to probe, scan, or test the vulnerability of our systems or networks;</li>
            <li>Circumvent any security, rate-limiting, or access-control mechanism;</li>
            <li>Scrape, crawl, or bulk-extract data from the Service in a manner that disrupts or overloads it;</li>
            <li>Resell, sublicense, or white-label the Service without our prior written consent;</li>
            <li>
              Generate content that constitutes CSAM, glorifies terrorism, or is otherwise illegal regardless of
              jurisdiction.
            </li>
          </ul>
          <p>
            We may suspend or terminate your account immediately if we determine, in our sole discretion, that you
            have violated this section.
          </p>
        </Section>

        <Section id="byok" title="7. Bring Your Own Keys (BYOK)">
          <p>
            Certain plans allow you to supply API keys for third-party AI providers ("BYOK"). By submitting a BYOK
            key you represent that you are authorized to use that key and that such use complies with the applicable
            provider's terms. You are solely responsible for all API costs, rate limits, and usage policies imposed
            by the third-party provider. We encrypt your keys at rest and do not log them, but we are not responsible
            for the security practices of those providers.
          </p>
        </Section>

        <Section id="intellectual-property" title="8. Intellectual Property">
          <p>
            <strong className="text-r1-text">Our IP.</strong> The Service, including its software, design, trademarks,
            and underlying models, is owned by the Company or its licensors and is protected by intellectual property
            law. You may not copy, modify, distribute, sell, or lease any part of the Service.
          </p>
          <p>
            <strong className="text-r1-text">Your content.</strong> You retain ownership of research objectives,
            custom corpora, and other materials you submit to the Service ("User Content"). By submitting User Content
            you grant us a limited, worldwide, royalty-free license to process and store it solely for the purpose of
            providing the Service to you.
          </p>
          <p>
            <strong className="text-r1-text">Report outputs.</strong> Subject to your compliance with these Terms and
            full payment of applicable fees, you own the reports generated from your queries. We do not claim
            ownership of report outputs, but we may use anonymized aggregate usage data to improve the Service.
          </p>
        </Section>

        <Section id="privacy" title="9. Privacy">
          <p>
            Our collection and use of personal information is described in our{' '}
            <a href="/privacy" className="text-r1-accent hover:underline">
              Privacy Policy
            </a>
            , which is incorporated into these Terms by reference. By using the Service you consent to our data
            practices as described therein.
          </p>
        </Section>

        <Section id="third-party" title="10. Third-Party Services">
          <p>
            The Service may integrate with or link to third-party websites, APIs, or services. These third parties
            have their own terms and privacy policies, and we are not responsible for their content or practices. Your
            use of third-party services is at your own risk.
          </p>
        </Section>

        <Section id="disclaimers" title="11. Disclaimers">
          <p>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR
            IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
            ACCURACY, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR
            FREE OF HARMFUL COMPONENTS. AI-GENERATED REPORTS MAY CONTAIN ERRORS, HALLUCINATIONS, OR OUTDATED
            INFORMATION; YOU USE THEM AT YOUR OWN RISK.
          </p>
        </Section>

        <Section id="limitation-of-liability" title="12. Limitation of Liability">
          <p>
            TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE COMPANY, ITS DIRECTORS,
            EMPLOYEES, AGENTS, OR LICENSORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
            PUNITIVE DAMAGES ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE, EVEN IF WE HAVE BEEN ADVISED OF
            THE POSSIBILITY OF SUCH DAMAGES.
          </p>
          <p>
            OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATED TO THESE TERMS OR THE SERVICE
            SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID US IN THE 12 MONTHS IMMEDIATELY PRECEDING THE
            CLAIM OR (B) ONE HUNDRED US DOLLARS ($100).
          </p>
          <p>
            Some jurisdictions do not allow the exclusion or limitation of certain warranties or liabilities. In those
            jurisdictions, our liability is limited to the maximum extent permitted by law.
          </p>
        </Section>

        <Section id="indemnification" title="13. Indemnification">
          <p>
            You agree to indemnify, defend, and hold harmless the Company and its officers, directors, employees, and
            agents from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal
            fees) arising out of or in any way connected with (a) your access to or use of the Service; (b) your User
            Content; (c) your violation of these Terms; or (d) your violation of any third party's rights.
          </p>
        </Section>

        <Section id="termination" title="14. Termination">
          <p>
            You may close your account at any time from account settings. We may suspend or terminate your access to
            the Service with or without notice if you violate these Terms, if we discontinue the Service, or for any
            other reason at our discretion.
          </p>
          <p>
            Upon termination, your right to use the Service ceases immediately. Sections 8, 11, 12, 13, 15, and 16
            survive termination.
          </p>
        </Section>

        <Section id="modifications" title="15. Modifications to Terms">
          <p>
            We may update these Terms from time to time. We will post the revised Terms on this page and update the
            effective date. For material changes, we will provide at least 14 days' advance notice (e.g., by email or
            in-app notification). Your continued use of the Service after the effective date of the updated Terms
            constitutes your acceptance.
          </p>
        </Section>

        <Section id="governing-law" title="16. Governing Law and Disputes">
          <p>
            These Terms are governed by and construed in accordance with the laws of the State of Delaware, United
            States, without regard to its conflict-of-law principles.
          </p>
          <p>
            Any dispute arising out of or relating to these Terms or the Service shall first be submitted to informal
            negotiation for 30 days. If unresolved, disputes shall be submitted to binding arbitration under the
            rules of the American Arbitration Association (AAA) in San Francisco, California. The arbitration shall
            be conducted in English on a confidential basis. Notwithstanding the foregoing, either party may seek
            injunctive or other equitable relief in a court of competent jurisdiction to prevent irreparable harm.
          </p>
          <p>
            <strong className="text-r1-text">Class action waiver.</strong> You and the Company agree that any
            arbitration or court proceeding shall be conducted only on an individual basis and not in a class,
            consolidated, or representative action.
          </p>
        </Section>

        <Section id="general" title="17. General">
          <p>
            <strong className="text-r1-text">Entire agreement.</strong> These Terms, together with the Privacy Policy
            and any order forms or supplemental agreements you have signed, constitute the entire agreement between
            you and the Company regarding the Service and supersede all prior agreements.
          </p>
          <p>
            <strong className="text-r1-text">Severability.</strong> If any provision of these Terms is found to be
            unenforceable, the remaining provisions will remain in full force and effect.
          </p>
          <p>
            <strong className="text-r1-text">Waiver.</strong> Our failure to enforce any right or provision will not
            be considered a waiver of that right or provision.
          </p>
          <p>
            <strong className="text-r1-text">Assignment.</strong> You may not assign these Terms or your rights under
            them without our prior written consent. We may assign our rights and obligations freely.
          </p>
        </Section>

        <Section id="contact" title="18. Contact Us">
          <p>
            Questions about these Terms should be directed to:{' '}
            <a href="mailto:legal@researchone.app" className="text-r1-accent hover:underline">
              legal@researchone.app
            </a>
            .
          </p>
        </Section>
      </main>
      <LandingFooter />
    </div>
  );
}

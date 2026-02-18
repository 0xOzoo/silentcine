import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const Refund = () => (
  <div className="min-h-screen py-10 px-4">
    <div className="container max-w-3xl mx-auto">
      <Button variant="ghost" asChild className="mb-8">
        <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link>
      </Button>

      <h1 className="font-display text-3xl font-bold mb-8">Refund Policy</h1>
      <div className="prose prose-invert prose-sm max-w-none space-y-6 text-muted-foreground">

        <p><strong>Effective Date:</strong> February 18, 2026</p>

        <h2 className="text-foreground text-lg font-semibold">1. Event Pass (One-time Purchase)</h2>
        <ul className="list-disc list-inside space-y-2">
          <li><strong>Before activation:</strong> Full refund within 14 days of purchase (EU cooling-off period, Directive 2011/83/EU).</li>
          <li><strong>After activation:</strong> No refund. The 48-hour access window begins immediately upon activation and constitutes delivery of the digital service.</li>
          <li><strong>Expired without activation:</strong> If the 30-day activation window expires without use, automatic full refund.</li>
        </ul>

        <h2 className="text-foreground text-lg font-semibold">2. Pro Subscription (Monthly)</h2>
        <ul className="list-disc list-inside space-y-2">
          <li><strong>First 14 days:</strong> Full refund if no movies have been uploaded during the billing period.</li>
          <li><strong>After 14 days or with usage:</strong> No refund for the current billing period. You may cancel at any time; access continues until the end of the paid period.</li>
          <li><strong>Proration on downgrade:</strong> If downgrading from Enterprise to Pro mid-cycle, the difference is credited toward the next billing period.</li>
        </ul>

        <h2 className="text-foreground text-lg font-semibold">3. Enterprise Subscription (Monthly)</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>Same refund rules as Pro subscription.</li>
          <li><strong>Custom branding setup:</strong> Non-refundable once custom branding has been configured and deployed.</li>
          <li><strong>Downgrade:</strong> Prorated credit applied. White-label branding removed immediately upon downgrade.</li>
        </ul>

        <h2 className="text-foreground text-lg font-semibold">4. Free Tier</h2>
        <p>The Free tier is provided at no cost. No refunds apply.</p>

        <h2 className="text-foreground text-lg font-semibold">5. How to Request a Refund</h2>
        <p>Email <span className="text-primary">billing@silentcine.com</span> with:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Your account email address</li>
          <li>The product/subscription you purchased</li>
          <li>The reason for your refund request</li>
        </ul>
        <p>We will process eligible refunds within 5-10 business days. Refunds are issued to the original payment method via Stripe.</p>

        <h2 className="text-foreground text-lg font-semibold">6. Chargebacks</h2>
        <p>If you initiate a chargeback with your bank instead of contacting us, we reserve the right to suspend your account pending resolution. We encourage you to contact us first for faster resolution.</p>

        <h2 className="text-foreground text-lg font-semibold">7. EU Consumer Rights</h2>
        <p>European Union consumers have the right to withdraw from a digital content purchase within 14 days, provided the service has not been fully performed with the consumer's prior express consent and acknowledgement that the right of withdrawal is lost. By activating an Event Pass or uploading content on a paid tier, you acknowledge and consent to the immediate performance of the service.</p>
      </div>
    </div>
  </div>
);

export default Refund;

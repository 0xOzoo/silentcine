import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const Terms = () => (
  <div className="min-h-screen py-10 px-4">
    <div className="container max-w-3xl mx-auto">
      <Button variant="ghost" asChild className="mb-8">
        <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link>
      </Button>

      <h1 className="font-display text-3xl font-bold mb-8">Terms of Service</h1>
      <div className="prose prose-invert prose-sm max-w-none space-y-6 text-muted-foreground">

        <p><strong>Effective Date:</strong> February 18, 2026</p>

        <h2 className="text-foreground text-lg font-semibold">1. Acceptance of Terms</h2>
        <p>By accessing or using SilentCine ("Service"), you agree to be bound by these Terms. If you do not agree, do not use the Service.</p>

        <h2 className="text-foreground text-lg font-semibold">2. Description of Service</h2>
        <p>SilentCine is a web application that allows hosts to project video content while streaming synchronized audio to audience members' personal devices via headphones.</p>

        <h2 className="text-foreground text-lg font-semibold">3. User Content & Copyright</h2>
        <p>You are solely responsible for the content you upload to SilentCine. By uploading content, you represent and warrant that:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>You own or have all necessary rights, licenses, and permissions to use and distribute the content.</li>
          <li>Your content does not infringe any third party's intellectual property, privacy, or other rights.</li>
          <li>You will comply with all applicable copyright laws, including the DMCA.</li>
        </ul>
        <p>SilentCine does not claim ownership of your content. You grant SilentCine a limited, non-exclusive license to store, process (audio extraction), and transmit your content solely for the purpose of providing the Service.</p>

        <h2 className="text-foreground text-lg font-semibold">4. Prohibited Uses</h2>
        <p>You agree not to use the Service to:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Upload or stream content you do not have rights to distribute.</li>
          <li>Circumvent, disable, or interfere with security features of the Service.</li>
          <li>Use the Service for any illegal purpose or in violation of any local, national, or international law.</li>
          <li>Attempt to access another user's session without authorization.</li>
        </ul>

        <h2 className="text-foreground text-lg font-semibold">5. Service Tiers & Limitations</h2>
        <p>The Service offers multiple tiers (Free, Event Pass, Pro, Enterprise) with varying capabilities. Tier limits (quality, listener count, storage duration) are enforced automatically. Attempting to circumvent tier restrictions is a violation of these Terms.</p>

        <h2 className="text-foreground text-lg font-semibold">6. Data Retention</h2>
        <p>Uploaded content is retained according to your tier: Free (7 days), Event Pass (30 days), Pro/Enterprise (permanent while subscribed). Upon tier expiration or account deletion, content will be removed per our <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.</p>

        <h2 className="text-foreground text-lg font-semibold">7. Disclaimer of Warranties</h2>
        <p>THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. We do not guarantee uninterrupted or error-free operation. Audio synchronization accuracy may vary based on network conditions and device capabilities.</p>

        <h2 className="text-foreground text-lg font-semibold">8. Limitation of Liability</h2>
        <p>IN NO EVENT SHALL SILENTCINE BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SERVICE.</p>

        <h2 className="text-foreground text-lg font-semibold">9. Dispute Resolution</h2>
        <p>Any disputes arising from these Terms shall be resolved through binding arbitration in accordance with the laws of France. Both parties agree to attempt informal resolution before initiating formal proceedings.</p>

        <h2 className="text-foreground text-lg font-semibold">10. Changes to Terms</h2>
        <p>We may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance of the revised Terms.</p>

        <h2 className="text-foreground text-lg font-semibold">11. Contact</h2>
        <p>For questions about these Terms, contact us at <span className="text-primary">legal@silentcine.com</span>.</p>
      </div>
    </div>
  </div>
);

export default Terms;

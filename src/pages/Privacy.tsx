import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const Privacy = () => (
  <div className="min-h-screen py-10 px-4">
    <div className="container max-w-3xl mx-auto">
      <Button variant="ghost" asChild className="mb-8">
        <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link>
      </Button>

      <h1 className="font-display text-3xl font-bold mb-8">Privacy Policy</h1>
      <div className="prose prose-invert prose-sm max-w-none space-y-6 text-muted-foreground">

        <p><strong>Effective Date:</strong> February 18, 2026</p>
        <p>SilentCine ("we", "us") is committed to protecting your privacy. This policy explains how we collect, use, and protect your personal data in compliance with the EU General Data Protection Regulation (GDPR) and applicable French law.</p>

        <h2 className="text-foreground text-lg font-semibold">1. Data Controller</h2>
        <p>SilentCine, registered in France. Contact: <span className="text-primary">privacy@silentcine.com</span>.</p>

        <h2 className="text-foreground text-lg font-semibold">2. Data We Collect</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border">
            <th className="text-left py-2 text-foreground">Data</th>
            <th className="text-left py-2 text-foreground">Purpose</th>
            <th className="text-left py-2 text-foreground">Legal Basis</th>
            <th className="text-left py-2 text-foreground">Retention</th>
          </tr></thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-border/50"><td className="py-2">Email address</td><td>Account creation, communication</td><td>Contract (Art. 6(1)(b))</td><td>Until account deletion</td></tr>
            <tr className="border-b border-border/50"><td className="py-2">Password (hashed)</td><td>Authentication</td><td>Contract</td><td>Until account deletion</td></tr>
            <tr className="border-b border-border/50"><td className="py-2">Anonymous UUID</td><td>Session tracking for anonymous users</td><td>Legitimate interest (Art. 6(1)(f))</td><td>7 days from last use</td></tr>
            <tr className="border-b border-border/50"><td className="py-2">Uploaded video/audio</td><td>Service delivery</td><td>Contract</td><td>Per tier: 7/30 days or permanent</td></tr>
            <tr className="border-b border-border/50"><td className="py-2">IP address</td><td>Rate limiting, abuse prevention</td><td>Legitimate interest</td><td>5 minutes (rate limit window)</td></tr>
            <tr><td className="py-2">Payment data</td><td>Subscription billing</td><td>Contract</td><td>Per Stripe's retention policy</td></tr>
          </tbody>
        </table>

        <h2 className="text-foreground text-lg font-semibold">3. Data Processing</h2>
        <p>Uploaded video files are processed to extract audio tracks. This processing occurs on our dedicated extraction server. Video files are deleted from the extraction server immediately after processing. Audio files are stored in Supabase Storage with access restricted to session participants via signed URLs.</p>

        <h2 className="text-foreground text-lg font-semibold">4. Data Sharing</h2>
        <p>We share data only with:</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Supabase</strong> (database and file storage) — EU region</li>
          <li><strong>Stripe</strong> (payment processing) — PCI DSS compliant</li>
        </ul>
        <p>We do not sell personal data. We do not use third-party analytics or advertising trackers.</p>

        <h2 className="text-foreground text-lg font-semibold">5. Your Rights (GDPR Articles 15-22)</h2>
        <p>You have the right to:</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Access</strong> your personal data (Art. 15)</li>
          <li><strong>Rectify</strong> inaccurate data (Art. 16)</li>
          <li><strong>Erase</strong> your data ("right to be forgotten") (Art. 17)</li>
          <li><strong>Restrict</strong> processing (Art. 18)</li>
          <li><strong>Data portability</strong> — export your data in JSON format (Art. 20)</li>
          <li><strong>Object</strong> to processing (Art. 21)</li>
        </ul>
        <p>To exercise these rights, email <span className="text-primary">privacy@silentcine.com</span>. We will respond within 30 days.</p>

        <h2 className="text-foreground text-lg font-semibold">6. Data Retention</h2>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Free tier:</strong> Content deleted 7 days after upload.</li>
          <li><strong>Event Pass:</strong> Content deleted 30 days after upload.</li>
          <li><strong>Pro/Enterprise:</strong> Content retained permanently while subscription is active. Upon cancellation, 30-day grace period, then 7-day retention applies.</li>
          <li><strong>Account deletion:</strong> All personal data and content deleted within 30 days of request.</li>
        </ul>

        <h2 className="text-foreground text-lg font-semibold">7. Right to Erasure Procedure</h2>
        <p>Upon receiving a valid erasure request, we will:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Delete your profile data from our database.</li>
          <li>Delete all uploaded video and audio files from cloud storage.</li>
          <li>Request deletion of cached data from your browser's local storage (best effort — we cannot force client-side deletion).</li>
          <li>Confirm deletion in writing within 30 days.</li>
        </ol>

        <h2 className="text-foreground text-lg font-semibold">8. Cookies & Local Storage</h2>
        <p>SilentCine uses browser localStorage for:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Authentication session persistence (Supabase Auth token)</li>
          <li>Anonymous user identification (UUID)</li>
          <li>Host session tokens (sessionStorage, cleared on tab close)</li>
        </ul>
        <p>We do not use tracking cookies or third-party cookies.</p>

        <h2 className="text-foreground text-lg font-semibold">9. Supervisory Authority</h2>
        <p>If you believe your data protection rights have been violated, you have the right to lodge a complaint with the CNIL (Commission Nationale de l'Informatique et des Libertes), France's data protection authority.</p>

        <h2 className="text-foreground text-lg font-semibold">10. Changes</h2>
        <p>We will notify users of material changes to this policy via email or in-app notification.</p>
      </div>
    </div>
  </div>
);

export default Privacy;

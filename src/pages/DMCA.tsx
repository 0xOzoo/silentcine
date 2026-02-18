import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const DMCA = () => (
  <div className="min-h-screen py-10 px-4">
    <div className="container max-w-3xl mx-auto">
      <Button variant="ghost" asChild className="mb-8">
        <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link>
      </Button>

      <h1 className="font-display text-3xl font-bold mb-8">DMCA & Copyright Policy</h1>
      <div className="prose prose-invert prose-sm max-w-none space-y-6 text-muted-foreground">

        <p><strong>Effective Date:</strong> February 18, 2026</p>
        <p>SilentCine respects the intellectual property rights of others and expects users to do the same. We respond to notices of alleged copyright infringement in accordance with the Digital Millennium Copyright Act (DMCA) and applicable EU Directive 2001/29/EC.</p>

        <h2 className="text-foreground text-lg font-semibold">1. Reporting Copyright Infringement</h2>
        <p>If you believe content hosted on SilentCine infringes your copyright, submit a takedown notice to our designated agent with the following information:</p>
        <ol className="list-decimal list-inside space-y-2">
          <li>Your physical or electronic signature.</li>
          <li>Identification of the copyrighted work you claim has been infringed.</li>
          <li>Identification of the infringing material on SilentCine (e.g., session code, URL, or description).</li>
          <li>Your contact information (name, address, phone number, email).</li>
          <li>A statement that you have a good faith belief that the use is not authorized by the copyright owner, its agent, or the law.</li>
          <li>A statement, under penalty of perjury, that the information in your notice is accurate and that you are the copyright owner or authorized to act on their behalf.</li>
        </ol>

        <h2 className="text-foreground text-lg font-semibold">2. Designated Agent</h2>
        <div className="p-4 rounded-lg bg-muted/30 border border-border">
          <p><strong>SilentCine DMCA Agent</strong></p>
          <p>Email: <span className="text-primary">dmca@silentcine.com</span></p>
        </div>

        <h2 className="text-foreground text-lg font-semibold">3. Takedown Procedure</h2>
        <p>Upon receiving a valid takedown notice, we will:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Remove or disable access to the infringing content within 24 hours.</li>
          <li>Notify the content uploader of the takedown.</li>
          <li>Delete the content from our storage systems.</li>
          <li>Attempt to trigger client-side cache deletion on connected devices (best effort).</li>
        </ol>

        <h2 className="text-foreground text-lg font-semibold">4. Counter-Notice</h2>
        <p>If you believe your content was removed in error, you may submit a counter-notice containing:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Your physical or electronic signature.</li>
          <li>Identification of the removed material and its prior location.</li>
          <li>A statement under penalty of perjury that you have a good faith belief the material was removed by mistake.</li>
          <li>Your name, address, phone number, and consent to jurisdiction.</li>
        </ol>
        <p>Upon receiving a valid counter-notice, we will forward it to the original complainant and restore the content within 10-14 business days unless the complainant files a court action.</p>

        <h2 className="text-foreground text-lg font-semibold">5. Repeat Infringers</h2>
        <p>SilentCine will terminate access for users who are found to be repeat infringers. We maintain records of takedown notices received.</p>

        <h2 className="text-foreground text-lg font-semibold">6. Good Faith</h2>
        <p>SilentCine does not pre-screen uploaded content. We rely on user responsibility and the DMCA notice-and-takedown process to address copyright concerns.</p>
      </div>
    </div>
  </div>
);

export default DMCA;

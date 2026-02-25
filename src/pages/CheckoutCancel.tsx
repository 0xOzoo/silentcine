import { Link } from 'react-router-dom';
import { ArrowLeft, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const CheckoutCancel = () => {
  return (
    <div className="min-h-screen py-10 px-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-md">
        <Button variant="ghost" asChild className="mb-8">
          <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" />Back to Home</Link>
        </Button>

        <Card className="border-border">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4">
              <XCircle className="w-12 h-12 text-muted-foreground" />
            </div>
            <CardTitle className="text-xl">Checkout Cancelled</CardTitle>
            <CardDescription>
              Your payment was not completed. No charges were made to your account.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Changed your mind? You can always come back and upgrade later.
              Your current plan and data remain unchanged.
            </p>

            <div className="flex flex-col gap-2">
              <Button asChild className="w-full">
                <Link to="/pricing">View Plans Again</Link>
              </Button>
              <Button variant="outline" asChild className="w-full">
                <Link to="/">Go Home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CheckoutCancel;

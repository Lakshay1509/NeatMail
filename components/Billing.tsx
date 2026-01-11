"use client";

import { Button } from "@/components/ui/button";
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed";
import { AlertTriangle, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const Billing = () => {
  const { data, isLoading: dataLoading, isError } = useGetUserSubscribed();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handlebilling = async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (response.ok) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Something went wrong");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async (renew: string) => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/checkout/cancelSubscription?renew=${renew}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (response.ok) {
        if (renew === 'true') {
          toast.success(
            "Subscription cancelled you won't be charged on next billing date!"
          );
        }

        if (renew === 'false') {
          toast.success("Subscription renewed!");
        }

        // Reload after 3 seconds
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      }
      else {
        setError(data.error || "Something went wrong");
      }
    } catch (err) {
      setError("Network error. Please try again.");
      console.log(err)
    } finally {
      setIsLoading(false);
    }
  };

  if (dataLoading) return <div>Loading...</div>;

  return (
    <div className="w-full text-zinc-900">
      <div className="flex flex-col items-start gap-4 p-6 rounded-lg border border-zinc-200  bg-zinc-50  md:flex-row md:items-center md:justify-between md:gap-0">
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-zinc-900  text-white ">
            {data?.subscribed === true && <Check size={20} />}
            {data?.subscribed === false && <AlertTriangle size={20} />}
          </div>
          <div>
            {data?.subscribed === true && (
              <h2 className="text-lg font-semibold">Wuhu! You are subscribed!</h2>
            )}
            {data?.subscribed === false && (
              <h2 className="text-lg font-semibold">You are not subscribed!</h2>
            )}
            {data?.subscribed === true && (
              <p className="text-sm text-zinc-500 ">
                Enjoy all the premium benefits and advanced features of your Pro
                account.
              </p>
            )}
            {data?.subscribed === false && (
              <p className="text-sm text-zinc-500 ">
                Subscribe to enjoy all the premium benefits and advanced features
                of your pro account.
              </p>
            )}

            {data?.subscribed === true && data.next_billing_date && (
              <div className="mt-2 text-sm text-zinc-600">
                <p>
                  <span className="font-medium">Next billing date:</span>{" "}
                  {new Date(data.next_billing_date).toLocaleDateString(
                    "en-US",
                    {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }
                  )}
                </p>
                {data.cancel_at_next_billing_date ? (
                  <p className="text-amber-600 font-medium mt-2">
                    ⚠️ Subscription will not renew
                  </p>
                ) : (
                  <p className="text-green-600 font-medium mt-2">
                    ✓ Will renew automatically
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {error && (
          <span className="text-xs font-medium text-destructive">{error}</span>
        )}

        {data?.subscribed === true && data.cancel_at_next_billing_date === false && (
          <Button
            className="w-full md:w-auto px-4 py-2 text-sm font-medium text-white bg-red-700 rounded-md hover:bg-red-800 transaction-colors"
            onClick={() => { handleCancel('true') }}
            disabled={isLoading}
          >
            Cancel subscription
          </Button>
        )}
        {data?.subscribed === true && data.cancel_at_next_billing_date === true && (
          <Button
            className="w-full md:w-auto px-4 py-2 text-sm font-medium text-white rounded-md  transaction-colors"
            onClick={() => { handleCancel('false') }}
            disabled={isLoading}
          >
            Renew subscription
          </Button>
        )}

        {data?.subscribed === false && (
          <Button
            className="w-full md:w-auto px-4 py-2 text-sm font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800 transaction-colors"
            onClick={handlebilling}
            disabled={isLoading}
          >
            Join now
          </Button>
        )}
      </div>
    </div>
  );
};

export default Billing;
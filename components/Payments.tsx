"use client";

import { useGetUserPayments } from "@/features/user/use-get-user-payment";
import { useGetUserInvoice } from "@/features/user/use-get-user-invoice";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";

const Payments = () => {
  const { data, isLoading, isError } = useGetUserPayments();
  const { mutate: downloadInvoice, isPending: isDownloading } = useGetUserInvoice();

  if (isLoading) return <div>Loading payments...</div>;
  if (isError) return <div>Error loading payments</div>;

  return (
    <div className="rounded-md border p-4">
      <h2 className="mb-4 text-xl font-semibold">Payment History</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Id</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Billing Date</TableHead>
            <TableHead>Invoice</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.data.map((payment) => (
            <TableRow key={payment.id}>
             <TableCell>{payment.dodoPaymentId}</TableCell>
             <TableCell>{payment.amount/100}</TableCell>
             <TableCell>{payment.currency}</TableCell>
              <TableCell>{payment.status}</TableCell>
              <TableCell>{payment.paymentMethod || "N/A"}</TableCell>
              <TableCell>
                {payment.createdAt
                  ? new Date(payment.createdAt).toLocaleDateString()
                  : "N/A"}
              </TableCell>
              <TableCell>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  disabled={isDownloading || payment.invoiceId===null} 
                  onClick={() => downloadInvoice(payment.dodoPaymentId ?? '')}
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default Payments;
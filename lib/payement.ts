import { SubscriptionPayload } from "@/types/dodo";
import { db } from "./prisma";

export async function addSubscriptiontoDb(
  data:SubscriptionPayload
) {
  try {
    
    await db.subscription.upsert({
        where:{dodoSubscriptionId: data.data.subscription_id},
        update:{},
        create:{
            clerkUserId:data.data.metadata?.clerk_user_id,
            dodoSubscriptionId:data.data.subscription_id,
            dodoCustomerId:data.data.customer.customer_id,
            customerEmail:data.data.customer.email,
            status:data.data.status,
            productId:data.data.product_id,
            currency:data.data.currency,
            recurringAmount:data.data.recurring_pre_tax_amount,
            quantity:data.data.quantity,
            paymentFrequencyInterval:data.data.subscription_period_interval,
            paymentFrequencyCount:data.data.payment_frequency_count,
            nextBillingDate: new Date(data.data.next_billing_date),
            previousBillingDate: new Date(data.data.previous_billing_date),
            cancelAtNextBillingDate: data.data.cancel_at_next_billing_date,
            metadata:data.data.metadata || {},
        }

    })
    
  } catch (error) {
    console.error("Error adding subscription to db",error);
    throw error;
  }
}
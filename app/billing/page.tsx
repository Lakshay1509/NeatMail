import Billing from "@/components/Billing"
import CustomerPortal from "@/components/CustomerPortal"

const Page = () => {
  return (
    <div className="w-full p-6 md:px-10 space-y-8">
      <h1 className="text-2xl font-semibold font-logo tracking-tight">Billing & subscription</h1>
      <Billing />
      <CustomerPortal />
    </div>
  )
}

export default Page

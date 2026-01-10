import Billing from "../components/Billing"
import Payments from "../components/Payments"


const page = () => {
  return (
    <div className="w-full  p-6 md:px-10 space-y-6">
      <h1 className="text-2xl font-bold">Billing & Subscription</h1>
      <Billing/>
      <Payments/>
    </div>
  )
}

export default page
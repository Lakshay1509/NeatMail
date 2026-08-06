import TrackedEmail from "@/components/TrackedEmail"
import { PageHeader } from "@/components/PageHeader"


const page = () => {
  return (
    <>
      <PageHeader title="Emails" />
      <div className="w-full p-4 space-y-4">
        <TrackedEmail limit={50} dashboard={false} />
      </div>
    </>
  )
}

export default page

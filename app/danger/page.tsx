import DeleteUser from "@/components/DeleteUser"
import { PageHeader } from "@/components/PageHeader"


const page = () => {

  return (
    <>
      <PageHeader title="Danger zone" />
      <div className="w-full p-6 md:px-10">
        <DeleteUser />
      </div>
    </>
  )
}

export default page

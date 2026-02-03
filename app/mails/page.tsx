import TrackedEmail from "@/components/TrackedEmail"


const page = () => {
  return (
    <div className="w-full p-4 space-y-4">
        <TrackedEmail limit={50} dashboard={false}/>
        
    </div>
  )
}

export default page
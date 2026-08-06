import FollowUps from "@/components/FollowUps";
import { PageHeader } from "@/components/PageHeader";

const Page = () => {
  return (
    <>
      <PageHeader title="Follow-ups" />
      <div className="w-full p-4">
        <FollowUps />
      </div>
    </>
  );
};

export default Page;

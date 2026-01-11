import Dashboard from "@/components/Dashboard";
import UserLabel from "@/components/UserLabel";


export default function Home() {

  return (
    <main className="flex-1 overflow-auto">
      <div className="w-full p-6 md:px-10">
        <UserLabel />
        <Dashboard />
      </div>

    </main>
  );
}

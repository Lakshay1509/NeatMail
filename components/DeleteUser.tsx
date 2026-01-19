"use client";

import { useGetUserDeleteStatus } from "@/features/user/use-get-user-deleteStatus";
import { useDeleteUser } from "@/features/user/use-post-delete";
import { Button } from "./ui/button";
import { useState } from "react";
import { Input } from "./ui/input";

const DeleteUser = () => {
  const { data, isLoading, isError } = useGetUserDeleteStatus();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const isDeleted = data?.data.deleted_flag ?? false;
  const status = isDeleted ? 'cancel' : 'request';
  const mutation = useDeleteUser(status);

  const handleClick = async () => {
    if (status === 'request') {
      setShowConfirm(true);
    } else {
      await mutation.mutateAsync();
    }
  };

  const handleConfirmDelete = async () => {
    if (confirmText === "Delete Account") {
      await mutation.mutateAsync();
      setShowConfirm(false);
      setConfirmText("");
    }
  };

  const handleCancelConfirm = () => {
    setShowConfirm(false);
    setConfirmText("");
  };

  if (isLoading) return <div>Loading...</div>;
  
  if (isError) return <div>Error loading delete status</div>;

  return (
    <div className="flex justify-between items-center p-4 border rounded-lg bg-red-50 border-red-200">
      <div className="flex flex-col">
        <h3 className="text-lg font-semibold text-red-700">Delete Account</h3>
        <p className="text-sm text-red-600">
          {isDeleted
            ? `Your account is scheduled for deletion on ${new Date(
                data?.data.delete_at!
              ).toLocaleDateString()}.`
            : "Once you delete your account, you can recover it within 30 days."}
        </p>
      </div>
      <div>
        {showConfirm && !isDeleted ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-red-600 mb-1">Type "Delete Account" to confirm</p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Delete Account"
              className="bg-white"
            />
            <div className="flex gap-2 mt-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmDelete}
                disabled={confirmText !== "Delete Account" || mutation.isPending}
              >
                Confirm
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelConfirm}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="destructive"
            className="px-4 py-2"
            onClick={handleClick}
            disabled={mutation.isPending}
          >
            {isDeleted ? "Cancel Deletion" : "Delete Account"}
          </Button>
        )}
      </div>
    </div>
  );
};

export default DeleteUser;
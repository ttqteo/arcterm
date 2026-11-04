// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Stack-rendered confirm dialog (pushModal("ConfirmModal", …)). Thin wrapper over ConfirmDialog —
// the Canvas-13 alert. Destructive confirms render the danger tone; everything else is info.

import { ConfirmDialog } from "@/app/modals/confirmdialog";
import { modalsModel } from "@/app/store/modalmodel";
import type { ConfirmHow } from "@/app/view/agents/closelog";

interface ConfirmModalProps {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    altLabel?: string;
    onAlt?: () => void;
    onConfirm: (how: ConfirmHow) => void;
}

const ConfirmModal = ({
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive,
    altLabel,
    onAlt,
    onConfirm,
}: ConfirmModalProps) => {
    const close = () => modalsModel.popModal();
    const confirm = (how: ConfirmHow) => {
        close();
        onConfirm(how);
    };
    const alt = () => {
        close();
        onAlt?.();
    };

    return (
        <ConfirmDialog
            tone={destructive ? "danger" : "info"}
            title={title}
            body={message}
            confirmLabel={confirmLabel}
            cancelLabel={cancelLabel}
            altLabel={altLabel}
            onAlt={onAlt ? alt : undefined}
            onConfirm={confirm}
            onClose={close}
        />
    );
};

ConfirmModal.displayName = "ConfirmModal";

export { ConfirmModal };

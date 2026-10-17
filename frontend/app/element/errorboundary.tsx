// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";

export class NullErrorBoundary extends React.Component<
    { children: React.ReactNode; debugName?: string },
    { hasError: boolean }
> {
    constructor(props: { children: React.ReactNode; debugName?: string }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error(`${this.props.debugName ?? "NullErrorBoundary"} error boundary caught error`, error, info);
    }

    render() {
        if (this.state.hasError) {
            return null;
        }
        return this.props.children;
    }
}

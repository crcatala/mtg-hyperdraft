// Catches a 3D pack that fails to start (lost context, a driver that can't do the shaders…) so the
// Draft screen can swap in the CSS pack instead of a blank space.

import { Component, type ReactNode } from "react";

export class PackBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("3D pack failed, using the simple pack:", error);
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

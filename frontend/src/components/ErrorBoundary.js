import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface to console so it's visible in the browser devtools too.
    console.error("App crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#fafaf9", fontFamily: "system-ui, sans-serif" }}>
          <div style={{ maxWidth: 560, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 16, padding: 32 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1c1917", margin: 0 }}>Something went wrong</h1>
            <p style={{ color: "#57534e", marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
              The app failed to start. This is usually a missing configuration value.
            </p>
            <pre style={{ marginTop: 16, background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 8, padding: 12, fontSize: 12, color: "#b91c1c", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

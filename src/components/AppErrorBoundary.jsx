import { Component } from "react";

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error, info) {
    console.error("Wordle World render failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-error-boundary" role="alert">
        <strong>The board could not be displayed</strong>
        <p>Your game is still saved. Reload this view or return to the Daily Challenge.</p>
        <div>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
          <a href="/play/daily">Return to Daily</a>
        </div>
      </main>
    );
  }
}

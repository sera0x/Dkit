import { Component } from 'react';

// Catches render/lifecycle errors anywhere below it in the tree. Without
// this, an uncaught error in any one component (e.g. a WebGL failure)
// unmounts the entire app, leaving a blank page with no visible cause.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || String(error) };
  }

  componentDidCatch(error, info) {
    console.error('Dkit website crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#fff' }}>
            Something went wrong: {this.state.message}
          </div>
        )
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;

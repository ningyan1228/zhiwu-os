import { Component, type ReactNode } from 'react'
export class KnowledgeBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<section className="knowledge-loading" role="alert"><h2>页面暂未打开</h2><p>请刷新后重试。你也可以继续使用工作站的其他页面。</p><button onClick={()=>window.location.reload()}>刷新页面</button></section>:this.props.children}
}

import Link from '@docusaurus/Link'
import useBaseUrl from '@docusaurus/useBaseUrl'
import Heading from '@theme/Heading'
import ThemedImage from '@theme/ThemedImage'

import styles from './styles.module.css'

type FeatureItem = {
  img: string
  title: string
  description: string
  link: string
}

function Feature({ img, title, description, link }: FeatureItem) {
  return (
    <div className="col col--4">
      <div className="text--center">
        <ThemedImage
          className={styles.featureSvg}
          sources={{
            light: useBaseUrl(`/img/${img}-light.svg`),
            dark: useBaseUrl(`/img/${img}-dark.svg`),
          }}
        />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h2">{title}</Heading>
        <p>{description}</p>
        <Link
          className="button button--primary"
          to={link}
          data-umami-event="Home CTA"
          data-umami-event-cta={title}>
          Learn more
        </Link>
      </div>
    </div>
  )
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          <Feature
            img="build"
            title="Easily create MCP servers, clients and hosts"
            link="/docs/introduction/#easily-create-mcp-servers-clients-and-hosts"
            description="The Mokei libraries help create MCP servers and clients, as well as hosts spawning servers and managing their lifecycle."
          />
          <Feature
            img="monitor"
            title="Proxy and monitor client-server interactions"
            link="/docs/introduction/#proxy-and-monitor-client-server-interactions"
            description="The Mokei Monitor is a Web UI running locally that allows you to monitor the interactions between your MCP clients and servers using a local proxy."
          />
          <Feature
            img="interact"
            title="Interact with models running locally"
            link="/docs/introduction/#interact-with-models-running-locally"
            description="The Mokei CLI provides a simple integration with Ollama, allowing to provide MCP servers to conversations with models running locally."
          />
        </div>
      </div>
    </section>
  )
}

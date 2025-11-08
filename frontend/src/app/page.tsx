import Hero from '../components/Hero'
import Services from '../components/Services'
import ContactForm from '../components/ContactForm'
import AboutPreview from '../components/AboutPreview'
import Newsletter from '../components/Newsletter'
import GoogleMapSection from "../components/GoogleMapSection"
import ContactCTA from "../components/ContactCTA"
import NewsSection from "../components/NewsSection"

export default function Home() {
  return (
    <div className="w-full overflow-hidden"> {/* غيرت من overflow-x-hidden إلى overflow-hidden */}
      <Hero />
      
      <section className="w-full overflow-hidden">
        <div className="w-full">
          <AboutPreview />
        </div>
      </section>

      <section className="w-full overflow-hidden">
        <div className="w-full">
          <Services />
        </div>
      </section>

      <section className="w-full overflow-hidden">
        <div className="w-full">
          <NewsSection />
        </div>
      </section>

      

      <section className="w-full overflow-hidden">
        <div className="w-full">
          <Newsletter />
        </div>
      </section>

      <section className="w-full overflow-hidden">
        <div className="w-full">
          <ContactForm />
        </div>
      </section>

      <section className="w-full overflow-hidden">
        <div className="w-full">
          <GoogleMapSection />
        </div>
      </section>

<section className="w-full overflow-hidden">
        <div className="w-full">
          <ContactCTA />
        </div>
      </section>


    </div>
  )
}
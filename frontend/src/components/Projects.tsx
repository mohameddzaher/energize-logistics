'use client'
import { motion } from 'framer-motion'
import projects from '../data/projects'

export default function Projects() {
  return (
    <div id="projects" className="grid md:grid-cols-3 gap-6">
      {projects.map((p, i) => (
        <motion.article
          key={p.id}
          className="border rounded-lg overflow-hidden shadow-sm bg-white"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ delay: i * 0.1 }}
        >
          <img src={p.image} alt={p.title} className="w-full h-44 object-cover" />
          <div className="p-4">
            <h4 className="font-semibold mb-2">{p.title}</h4>
            <p className="text-sm text-muted">{p.summary}</p>
          </div>
        </motion.article>
      ))}
    </div>
  )
}

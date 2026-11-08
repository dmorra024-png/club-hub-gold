import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import { lookupGenetics, listGenetics, saveGenetics } from "@/lib/genetics-archive.functions";
import {
  botanicalFields,
  originalSpanishDescription,
  conflictingFacts,
  type BotanicalFact,
  type BotanicalImage,
} from "@/lib/genetics-archive";
import type { GeneticsResearch } from "@/lib/genetics-research.server";
export const Route = createFileRoute("/_authenticated/geneticas")({ component: GeneticsArchive });
const labels = {
  breeder: "Breeder",
  lineage: "Origen y genealogía",
  aroma: "Perfil aromático",
  botany: "Características botánicas",
};
function GeneticsArchive() {
  const { isAdmin, access, loading } = useAuth();
  const [name, setName] = useState(""),
    [facts, setFacts] = useState<BotanicalFact[]>([]),
    [description, setDescription] = useState(""),
    [image, setImage] = useState<BotanicalImage | null>(null),
    [research, setResearch] = useState<GeneticsResearch | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [archiveError, setArchiveError] = useState(""),
    [rows, setRows] = useState<any[]>([]),
    [confirmed, setConfirmed] = useState(false);
  const club = access.clubId;
  const generation = useRef(0);
  const saving = useRef(false);
  useEffect(() => {
    generation.current++;
    setRows([]);
    setResearch(null);
    setName("");
    setFacts([]);
    setDescription("");
    setImage(null);
    setConfirmed(false);
    setArchiveError("");
    if (!club) return;
    let alive = true;
    listGenetics()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e) => {
        if (alive) setArchiveError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [club]);
  useEffect(() => {
    if (!club) return;
    function consume() {
      try {
        const raw = sessionStorage.getItem("snoop:genetics-query");
        sessionStorage.removeItem("snoop:genetics-query");
        if (raw) {
          const d = JSON.parse(raw);
          if (Date.now() - d.at >= 0 && Date.now() - d.at < 120000 && typeof d.query === "string") {
            generation.current++;
            setName(d.query.slice(0, 100));
            setFacts([]);
            setDescription("");
            setResearch(null);
            setImage(null);
            setConfirmed(false);
          }
        }
      } catch {}
    }
    consume();
    window.addEventListener("snoop:genetics-query", consume);
    return () => window.removeEventListener("snoop:genetics-query", consume);
  }, [club]);
  async function search() {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      const r = await lookupGenetics({ data: { name } });
      if (current !== generation.current) return;
      setResearch(r);
      setFacts(r.facts);
      setImage(null);
      setDescription(originalSpanishDescription(name, r.facts));
    } catch (e) {
      if (current !== generation.current) return;
      setError(
        e instanceof Error ? e.message : "Búsqueda no disponible. Puedes continuar manualmente.",
      );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  function editFact(index: number, field: keyof BotanicalFact, value: string) {
    setConfirmed(false);
    setFacts((f) => f.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  }
  async function ownPhoto(file?: File) {
    if (!file) return;
    const current = ++generation.current;
    setError("");
    setConfirmed(false);
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5_000_000)
        throw new Error("Usa JPEG, PNG o WebP de hasta 5 MB.");
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      if (current !== generation.current) return;
      setImage({
        url: canvas.toDataURL("image/jpeg", 0.8),
        source: "own:confirmed",
        title: name,
        author: "Fotografía aportada por el administrador",
        license: "Propia",
        license_url: "own:confirmed",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir la fotografía.");
    }
  }
  async function save() {
    if (!confirmed || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await saveGenetics({ data: { name, facts, description, image, confirmed: true } });
      setRows(await listGenetics());
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const discrepancies = conflictingFacts(facts);
  return (
    <SnoopLayout
      title="Archivo informativo de genéticas"
      subtitle="Botánica y documentación · independiente de productos, stock y contabilidad"
    >
      <p>Consulta interna del club. No contiene precios ni operaciones comerciales.</p>
      {archiveError && (
        <p role="status">
          {archiveError} Puedes preparar y descargar una ficha revisada sin guardarla en el
          servidor.
        </p>
      )}
      <section aria-label="Fichas revisadas">
        {rows.length ? (
          rows.map((row) => (
            <article key={row.id} className="genetics-record">
              <h2>{row.name}</h2>
              {row.image && (
                <img src={row.image.url} alt={row.image.title} referrerPolicy="no-referrer" />
              )}
              <p>{row.description}</p>
              <ul>
                {row.facts?.map((f: BotanicalFact, i: number) => (
                  <li key={i}>
                    {labels[f.field]}: {f.value} ·{" "}
                    <a href={f.source} target="_blank" rel="noopener noreferrer">
                      Fuente
                    </a>
                  </li>
                ))}
              </ul>
              {row.image && (
                <p>
                  {row.image.author} · {row.image.license}{" "}
                  {row.image.source !== "own:confirmed" && (
                    <a href={row.image.source} target="_blank" rel="noopener noreferrer">
                      Fuente de la fotografía
                    </a>
                  )}
                </p>
              )}
            </article>
          ))
        ) : (
          <p>No hay fichas revisadas disponibles.</p>
        )}
      </section>
      {isAdmin && (
        <section className="genetics-editor" aria-label="Preparar ficha informativa">
          <h2>Nueva ficha informativa</h2>
          <label>
            Nombre de la genética
            <input
              value={name}
              maxLength={100}
              onChange={(e) => {
                generation.current++;
                setBusy(false);
                setName(e.target.value);
                setResearch(null);
                setFacts([]);
                setImage(null);
                setDescription("");
                setConfirmed(false);
              }}
            />
          </label>
          <button type="button" disabled={busy || name.trim().length < 3} onClick={search}>
            {busy ? "Consultando fuentes…" : "✨ Buscar foto y descripción"}
          </button>
          <p>
            La búsqueda envía únicamente el nombre botánico. No envía socios, documentos ni datos
            del club. Los datos ausentes no se completan con suposiciones.
          </p>
          {research?.warnings.map((w, i) => (
            <p role="status" key={i}>
              {w}
            </p>
          ))}
          {research?.references.map((r) => (
            <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer">
              {r.title} · Wikidata (CC0)
            </a>
          ))}
          <div className="genetics-images">
            {research?.images.map((i) => (
              <figure key={i.url}>
                <img src={i.url} alt={i.title} referrerPolicy="no-referrer" />
                <figcaption>
                  {i.title} · {i.author} ·{" "}
                  <a href={i.license_url} target="_blank" rel="noopener noreferrer">
                    {i.license}
                  </a>{" "}
                  ·{" "}
                  <a href={i.source} target="_blank" rel="noopener noreferrer">
                    Fuente
                  </a>
                </figcaption>
                <button
                  type="button"
                  onClick={() => {
                    setImage(i);
                    setConfirmed(false);
                  }}
                >
                  Seleccionar tras verificar correspondencia
                </button>
              </figure>
            ))}
          </div>
          <label>
            Fotografía propia (se elimina metadata, no se envía a IA)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => ownPhoto(e.target.files?.[0])}
            />
          </label>
          {image && (
            <figure>
              <img
                className="genetics-preview"
                src={image.url}
                alt={`Vista previa: ${name}`}
                referrerPolicy="no-referrer"
              />
              <figcaption>
                {image.author} · {image.license}
              </figcaption>
              <button
                type="button"
                onClick={() => {
                  setImage(null);
                  setConfirmed(false);
                }}
              >
                Quitar fotografía
              </button>
            </figure>
          )}
          <h3>Datos documentados</h3>
          <p>
            Añade únicamente información comprobada y la página informativa de origen. Las fuentes
            especializadas se consultan manualmente hasta disponer de autorización verificable para
            extracción.
          </p>
          {facts.map((f, i) => (
            <fieldset key={i}>
              <legend>Dato {i + 1}</legend>
              <select
                aria-label={`Campo ${i + 1}`}
                value={f.field}
                onChange={(e) => editFact(i, "field", e.target.value)}
              >
                {botanicalFields.map((b) => (
                  <option key={b} value={b}>
                    {labels[b]}
                  </option>
                ))}
              </select>
              <label>
                Información
                <input
                  value={f.value}
                  maxLength={500}
                  onChange={(e) => editFact(i, "value", e.target.value)}
                />
              </label>
              <label>
                URL de la fuente informativa
                <input
                  type="url"
                  value={f.source}
                  onChange={(e) => editFact(i, "source", e.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setFacts((v) => v.filter((_, n) => n !== i));
                  setConfirmed(false);
                }}
              >
                Retirar dato
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() => {
              setFacts((v) => [...v, { field: "botany", value: "", source: "" }]);
              setConfirmed(false);
            }}
            disabled={facts.length >= 30}
          >
            Añadir dato documentado
          </button>
          {discrepancies.length > 0 && (
            <p role="alert">
              Fuentes discrepantes: {discrepancies.map((f) => labels[f]).join(", ")}. Conserva ambas
              atribuciones y explica la discrepancia antes de confirmar.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setDescription(originalSpanishDescription(name, facts));
              setConfirmed(false);
            }}
            disabled={!facts.length}
          >
            Preparar descripción española con los datos documentados
          </button>
          <label htmlFor="genetics-description">Descripción informativa en español</label>
          <textarea
            id="genetics-description"
            rows={6}
            maxLength={4000}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setConfirmed(false);
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            He revisado nombre, fuentes, discrepancias, fotografía y derechos de uso. Confirmo la
            ficha.
          </label>
          <button
            type="button"
            disabled={!confirmed || busy || description.length < 20}
            onClick={save}
          >
            Guardar ficha revisada
          </button>
          <button
            type="button"
            disabled={!confirmed || description.length < 20}
            onClick={() => {
              const blob = new Blob(
                [JSON.stringify({ name, facts, description, image }, null, 2)],
                { type: "application/json" },
              );
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "snoop-ficha-informativa.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }}
          >
            Descargar ficha revisada
          </button>
          {error && <p role="alert">{error}</p>}
          <p>
            No se publica en Internet ni en un portal de socios. El acceso personal de socios no
            existe todavía en el sistema actual.
          </p>
        </section>
      )}
    </SnoopLayout>
  );
}

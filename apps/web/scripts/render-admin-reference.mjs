// Render original reference components for visual QA; never shipped to production.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const web = resolve(import.meta.dirname, "..");
const reference = resolve(web, "../../docs/src/app/(frontend)");
const output = join(web, "node_modules/.tmp/admin-visual");
await mkdir(output, { recursive: true });
const source = await readFile(join(reference, "CarlosParadiseApp.tsx"), "utf8");
const ast = ts.createSourceFile("reference.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const calendar = process.argv[2] === "calendar";
const details = process.argv[2] === "details";
const functions = new Set(["Icon", "Button", "Badge", "Logo", "Portal", "PageHead", ...(details ? ["AdminReservationDetail", "DetailField", "PesoInput"] : calendar ? ["CalendarPage"] : ["AdminDashboard", "QueueRows"])]);
const constants = new Set(["icons", "MANAGEMENT_RESERVATIONS", ...(details ? ["longDate", "sampleDate", "shortDateRange", "schedulePhase", "reservationDisplayStatus", "MANAGEMENT_RESERVATION_LIST", "PROTOTYPE_CURRENT_TIME"] : calendar ? ["longDate", "SAMPLE_OCULAR_VISIT", "PROTOTYPE_CURRENT_TIME"] : [])]);
const sections = ast.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && functions.has(node.name?.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => constants.has(declaration.name.getText(ast)))));
if (sections.length !== functions.size + constants.size) throw new Error("Expected reference components were not found.");
const moduleSource = `import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// CalendarPage itself overwrites this base fixture date to November 11, 2026.
const availableSampleDate = () => '2026-11-11';
const GuestStateContext = createContext({ notifications: [], adminNotifications: [], depositReviewDecisions: {}, reservationStatusOverrides: {}, blockedDates: [], staffReservations: [], selectedReservationId: 'reference', extensionAccessByReservation: {}, partialDepositAccessByReservation: {}, partialDepositAuthorizations: {}, depositSubmissions: [], extensionRequest: {status:'None'}, inquirySource:'Instagram', dayTourSchedule:'', dayTourPrice:'' });
${sections.map(node => node.getText(ast)).join("\n")}
export const html = renderToStaticMarkup(React.createElement(${details ? "AdminReservationDetail" : calendar ? "CalendarPage" : "AdminDashboard"}, { go: () => {}, role: 'Admin' }));`;
const compiled = ts.transpileModule(moduleSource, { compilerOptions: {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const modulePath = join(output, details ? "details-reference.mjs" : calendar ? "calendar-reference.mjs" : "reference.mjs");
await writeFile(modulePath, compiled);
const { html } = await import(pathToFileURL(modulePath).href);
const assets = join(web, "dist/assets");
const baseCss = (await readdir(assets)).find(name => /^index-.*\.css$/.test(name));
if (!baseCss) throw new Error("Run npm run build before generating the reference.");
const preflight = await readFile(join(assets, baseCss), "utf8");
const styles = (await readFile(join(reference, "styles.css"), "utf8")).replace('@import "tailwindcss";', "");
const fileName = details ? "details-reference.html" : calendar ? "calendar-reference.html" : "reference.html";
await writeFile(join(output, fileName), `<!doctype html><html><head><meta charset="utf-8"><base href="http://127.0.0.1:5175/"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${preflight}</style><style>${styles}</style></head><body>${html}</body></html>`);
console.log(`Rendered original reference to node_modules/.tmp/admin-visual/${fileName}`);

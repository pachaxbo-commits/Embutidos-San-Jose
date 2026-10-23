// Load document engines with the application. An already-open session keeps
// these modules after a deploy instead of requesting an obsolete chunk later.
import ExcelJS from 'exceljs'
export { jsPDF } from 'jspdf'
export { autoTable } from 'jspdf-autotable'
export const Workbook = ExcelJS.Workbook

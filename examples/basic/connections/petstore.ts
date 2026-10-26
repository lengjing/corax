import { defineOpenAPIConnection } from "corax/connections";

// Every operation in the spec becomes a tool the model can call.
export default defineOpenAPIConnection({
  description: "Swagger Petstore demo API.",
  spec: "https://petstore3.swagger.io/api/v3/openapi.json",
  baseUrl: "https://petstore3.swagger.io/api/v3",
});

{{/*
Expand the name of the chart.
*/}}
{{- define "games-hub.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "games-hub.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "games-hub.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "games-hub.labels" -}}
helm.sh/chart: {{ include "games-hub.chart" . }}
{{ include "games-hub.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "games-hub.selectorLabels" -}}
app.kubernetes.io/name: {{ include "games-hub.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "games-hub.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "games-hub.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Cloud saves: names of the generated secrets and the database host.
*/}}
{{- define "games-hub.pepperSecretName" -}}
{{- .Values.cloudSaves.pepper.existingSecret | default (printf "%s-pepper" (include "games-hub.fullname" .)) }}
{{- end }}

{{- define "games-hub.postgresqlName" -}}
{{- printf "%s-postgresql" (include "games-hub.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "games-hub.databaseSecretName" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.existingSecret | default (include "games-hub.postgresqlName" .) }}
{{- else }}
{{- .Values.externalDatabase.existingSecret }}
{{- end }}
{{- end }}

{{- define "games-hub.databasePasswordKey" -}}
{{- if .Values.postgresql.enabled }}{{ .Values.postgresql.auth.passwordKey }}{{ else }}{{ .Values.externalDatabase.passwordKey }}{{ end }}
{{- end }}

{{/*
Fails the render on settings that cannot work with cloud saves.
*/}}
{{- define "games-hub.validateCloudSaves" -}}
{{- if .Values.cloudSaves.enabled }}
{{- if or (gt (int .Values.replicaCount) 1) .Values.autoscaling.enabled }}
{{- fail "cloudSaves.enabled needs a single replica: rate limits for save codes and recovery are kept in memory. Set replicaCount: 1 and autoscaling.enabled: false." }}
{{- end }}
{{- if and (not .Values.postgresql.enabled) (not .Values.externalDatabase.host) }}
{{- fail "cloudSaves.enabled needs a database: set postgresql.enabled: true, or externalDatabase.host and externalDatabase.existingSecret." }}
{{- end }}
{{- if and (not .Values.postgresql.enabled) (not .Values.externalDatabase.existingSecret) }}
{{- fail "externalDatabase.existingSecret is required: a Secret holding the database password." }}
{{- end }}
{{- if and .Values.mail.enabled (not .Values.mail.host) }}
{{- fail "mail.enabled needs mail.host." }}
{{- end }}
{{- end }}
{{- end }}

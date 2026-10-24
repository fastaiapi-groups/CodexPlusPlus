FROM golang:1.27.0-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
COPY internal ./internal
RUN go test ./... && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /feedback .

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /feedback /feedback
USER 65532:65532
EXPOSE 6099
ENTRYPOINT ["/feedback"]
CMD ["-listen", "0.0.0.0:6099", "-state", "/data"]

<?php

namespace App\Controller;

use Exception;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\Routing\Annotation\Route;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class SteviaController extends AbstractController
{
    public function __construct(
        private HttpClientInterface $client,
        private string $apiStevia,
    ) {}

    /**
     * Streaming principal : proxy vers le backend FastAPI Stevia.
     */
    #[Route('/stevia/ask/stream', name: 'stevia_ask_stream', methods: ['POST'])]
    public function askSteviaStream(Request $request): StreamedResponse
    {
        $payload = json_decode($request->getContent(), true);

        if (!isset($payload['question'])) {
            return new StreamedResponse(
                fn() => print(json_encode(['content' => 'Aucune question reçue']) . "\n"),
                400,
                ['Content-Type' => 'text/event-stream']
            );
        }

        return new StreamedResponse(
            function () use ($payload) {
                try {
                    $response = $this->client->request('POST', $this->apiStevia . '/ask/stream', [
                        'json'   => ['question' => $payload['question'], 'roles' => ['user']],
                        'timeout' => 60,
                        'buffer' => false,
                    ]);

                    foreach ($this->client->stream($response) as $chunk) {
                        if ($chunk->isLast()) break;
                        $content = $chunk->getContent();
                        if (!empty($content)) {
                            echo $content;
                            if (ob_get_level() > 0) ob_flush();
                            flush();
                        }
                    }
                } catch (Exception $e) {
                    echo json_encode(['content' => $this->formatError($e)]) . "\n";
                    if (ob_get_level() > 0) ob_flush();
                    flush();
                }
            },
            200,
            [
                'Content-Type'     => 'text/event-stream',
                'Cache-Control'    => 'no-cache',
                'X-Accel-Buffering'=> 'no',
                'Connection'       => 'keep-alive',
            ]
        );
    }

    /**
     * Page d'indexation : liste les livres BookStack avec statut.
     */
    #[Route('/stevia/indexation', name: 'stevia_indexation', methods: ['GET'])]
    public function indexation(): Response
    {
        $books = $this->fetchBooks();

        return $this->render('stevia/indexation.html.twig', ['books' => $books]);
    }

    #[Route('/stevia/index/book/{bookId}', name: 'stevia_index_book', methods: ['POST'])]
    public function indexBook(int $bookId): JsonResponse
    {
        try {
            $response = $this->client->request(
                'POST',
                sprintf('%s/index/bookstack/book/%d?force=true', $this->apiStevia, $bookId),
                ['timeout' => 180]
            );
            $data = $response->toArray(false);
            $bookName = $data['book_name'] ?? 'Document';

            if (in_array($data['status'] ?? '', ['indexed', 'skipped'])) {
                $msg = $data['status'] === 'indexed'
                    ? sprintf('"%s" indexé avec succès.', $bookName)
                    : sprintf('"%s" est déjà à jour.', $bookName);
                $this->addFlash('success', $msg);
                return $this->json(['status' => 'success']);
            }

            $this->addFlash('danger', sprintf('Erreur lors de l\'indexation de "%s".', $bookName));
            return $this->json(['status' => 'error'], 400);

        } catch (Exception $e) {
            $this->addFlash('danger', 'Erreur technique : ' . $e->getMessage());
            return $this->json(['status' => 'error'], 500);
        }
    }

    #[Route('/stevia/delete/book/{bookId}', name: 'stevia_delete_book', methods: ['DELETE'])]
    public function deleteBook(int $bookId): JsonResponse
    {
        try {
            $response = $this->client->request(
                'DELETE',
                sprintf('%s/index/bookstack/book/%d', $this->apiStevia, $bookId),
                ['timeout' => 30]
            );
            $data = $response->toArray(false);
            $this->addFlash('success', sprintf('"%s" désindexé.', $data['book_name'] ?? 'Document'));
            return $this->json(['status' => 'success']);
        } catch (Exception $e) {
            $this->addFlash('danger', 'Erreur technique : ' . $e->getMessage());
            return $this->json(['status' => 'error'], 500);
        }
    }

    #[Route('/stevia/index/all', name: 'stevia_index_all', methods: ['POST'])]
    public function indexAll(): JsonResponse
    {
        try {
            $books = $this->fetchBooks();
            $nbIndexed = $nbErrors = 0;

            foreach ($books as $book) {
                $bookId = $book['id'] ?? null;
                if (!$bookId) continue;
                try {
                    $resp = $this->client->request(
                        'POST',
                        sprintf('%s/index/bookstack/book/%d?force=true', $this->apiStevia, $bookId),
                        ['timeout' => 600]
                    );
                    if (($resp->toArray(false)['status'] ?? '') === 'indexed') $nbIndexed++;
                } catch (\Exception) {
                    $nbErrors++;
                }
            }

            $this->addFlash('success', "Indexation terminée : {$nbIndexed} livre(s) indexé(s).");
            return $this->json(['status' => 'success', 'indexed' => $nbIndexed, 'errors' => $nbErrors]);
        } catch (\Exception $e) {
            $this->addFlash('danger', 'Erreur : ' . $e->getMessage());
            return $this->json(['status' => 'error'], 500);
        }
    }

    #[Route('/stevia/delete/all', name: 'stevia_delete_all', methods: ['DELETE'])]
    public function deleteAll(): JsonResponse
    {
        try {
            $response = $this->client->request('GET', $this->apiStevia . '/indexed/bookstack/books', ['timeout' => 30]);
            $books = $response->toArray(false)['data'] ?? [];
            $nbDeleted = $nbErrors = 0;

            foreach ($books as $book) {
                $bookId = $book['book_id'] ?? null;
                if (!$bookId) continue;
                try {
                    $resp = $this->client->request('DELETE', sprintf('%s/index/bookstack/book/%d', $this->apiStevia, $bookId), ['timeout' => 30]);
                    if (($resp->toArray(false)['status'] ?? '') === 'deleted') $nbDeleted++;
                } catch (\Exception) {
                    $nbErrors++;
                }
            }

            $this->addFlash('success', "Suppression terminée : {$nbDeleted} livre(s) supprimé(s).");
            return $this->json(['status' => 'success', 'deleted' => $nbDeleted, 'errors' => $nbErrors]);
        } catch (\Exception $e) {
            $this->addFlash('danger', 'Erreur : ' . $e->getMessage());
            return $this->json(['status' => 'error'], 500);
        }
    }

    #[Route('/stevia/health', name: 'stevia_health', methods: ['GET'])]
    public function health(): JsonResponse
    {
        try {
            $response = $this->client->request('GET', $this->apiStevia . '/health', ['timeout' => 5]);
            if ($response->getStatusCode() === 200 && ($response->toArray(false)['status'] ?? '') === 'online') {
                return $this->json(['status' => 'online']);
            }
        } catch (Exception $e) {
            return $this->json(['status' => 'offline', 'error' => $e->getMessage()], 503);
        }
        return $this->json(['status' => 'offline'], 503);
    }

    #[Route('/stevia/feedback', name: 'stevia_feedback', methods: ['POST'])]
    public function feedback(Request $request): JsonResponse
    {
        try {
            $response = $this->client->request('POST', $this->apiStevia . '/feedback', [
                'headers' => ['Content-Type' => 'application/json'],
                'body'    => $request->getContent(),
                'timeout' => 5,
            ]);
            return $this->json($response->toArray(false));
        } catch (\Exception $e) {
            return $this->json(['status' => 'ok']);
        }
    }

    private function fetchBooks(): array
    {
        try {
            $response = $this->client->request('GET', $this->apiStevia . '/bookstack/books', ['timeout' => 10]);
            if ($response->getStatusCode() === 200) {
                $payload = $response->toArray(false);
                if (($payload['status'] ?? '') === 'ok') {
                    return $payload['data'] ?? [];
                }
                $this->addFlash('warning', 'BookStack : ' . ($payload['message'] ?? 'Erreur inconnue'));
            }
        } catch (Exception $e) {
            $this->addFlash('warning', 'API Stevia inaccessible : ' . $e->getMessage());
        }
        return [];
    }

    private function formatError(Exception $e): string
    {
        if (str_contains($e->getMessage(), 'timeout')) return 'Délai dépassé — le modèle met trop de temps à répondre.';
        if (str_contains($e->getMessage(), 'Could not resolve host')) return 'Serveur Python inaccessible.';
        return 'Erreur : ' . $e->getMessage();
    }
}

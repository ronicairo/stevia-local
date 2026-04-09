<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\Routing\Annotation\Route;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class MlController extends AbstractController
{
    public function __construct(
        private HttpClientInterface $client,
        private string $apiStevia,
    ) {}

    #[Route('/stevia/ml', name: 'stevia_ml', methods: ['GET'])]
    public function index(): Response
    {
        try {
            $response = $this->client->request('GET', $this->apiStevia . '/ml/status', ['timeout' => 5]);
            $status   = $response->toArray(false);
        } catch (\Exception $e) {
            $status = ['model_trained' => false, 'error' => $e->getMessage()];
        }

        return $this->render('ml/index.html.twig', ['status' => $status]);
    }

    #[Route('/stevia/ml/status', name: 'stevia_ml_status', methods: ['GET'])]
    public function status(): JsonResponse
    {
        try {
            $response = $this->client->request('GET', $this->apiStevia . '/ml/status', ['timeout' => 5]);
            return new JsonResponse($response->toArray(false));
        } catch (\Exception $e) {
            return new JsonResponse(['error' => $e->getMessage()], 500);
        }
    }

    #[Route('/stevia/ml/run/{step}', name: 'stevia_ml_run', methods: ['POST'])]
    public function run(string $step): StreamedResponse
    {
        $apiUrl = $this->apiStevia . '/ml/run/' . $step;

        return new StreamedResponse(function () use ($apiUrl) {
            set_time_limit(0);
            $response = $this->client->request('POST', $apiUrl, ['timeout' => 600]);
            foreach ($this->client->stream($response) as $chunk) {
                echo $chunk->getContent();
                ob_flush();
                flush();
            }
        }, 200, [
            'Content-Type'  => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
